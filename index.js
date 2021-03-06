"use strict";

var util = require('util');
var EventEmitter = require('events').EventEmitter;
var os = require('os');
var fs = require('fs');
var path = require('path');
var net = require('net');
var debug = require('debug')('singles');

var onDeath = require('death')({uncaughtException: true});

function Singles(name) {
	if (!(this instanceof Singles))
		return new Singles(name);

	if (typeof name !== 'string')
		throw new Error('Missing Singles name');

	EventEmitter.call(this);

	this.name = name;

	this.socketPath = path.join(os.tmpdir(), this.name + '.sock');

	this.socket = null;
	this.master = true;

	this.clients = [];

	onDeath(function(signal, err) {
		debug('death: ' + signal);
		this.close();
		if (err) throw err;
		process.exit();
	}.bind(this));

	if (fs.existsSync(this.socketPath)) {
		// client mode
		this.master = false;
		this.connect();
	} else {
		// master mode
		this.createServer();
	}
}
util.inherits(Singles, EventEmitter);
module.exports = Singles;

Singles.prototype.connect = function() {
	debug('connecting: ' + this.socketPath);
	this.socket = net.connect({ path: this.socketPath });

	this.socket.on('connect', function() {
		debug('connected');
	}.bind(this));

	this.socket.on('close', function() {
		this.close();
		this.emit('close');
	}.bind(this));

	this.socket.on('data', this._handleMessage.bind(this));
	this.socket.on('error', this.emit.bind(this, 'error'));
	this.socket.on('end', this.emit.bind(this, 'end'));
	this.emit('connect');
};

Singles.prototype.createServer = function() {
	this.socket = net.createServer();

	this.socket.on('listening', function() {
		debug('listening: ' + this.socketPath);
		this.emit('listening');
	}.bind(this));

	this.socket.on('connection', function(client) {
		client.on('data', this._handleMessage.bind(this));
		client.on('close', function() {
			debug('client disconnected');
			this.clients.splice(this.clients.indexOf(client), 1);
		}.bind(this));
		client.send = function(message) {
			var json = prepareMessage(message);
			client.write(json);
		};
		this.clients.push(client);

		this.emit('connection', client);
		debug('client connected');
	}.bind(this));

	this.socket.on('close', function() {
		this.close();
		this.emit('close');
	}.bind(this));

	this.socket.on('error', this.emit.bind(this, 'error'));

	this.socket.listen(this.socketPath);
	debug('server created');
};

Singles.prototype._handleMessage = function(data) {
	if (!this._buffer) {
		this._buffer = data;
	} else if (data) {
		this._buffer = Buffer.concat([this._buffer, data]);
	}

	if (!this._msgLength) {
		this._msgLength = this._buffer.readUInt32BE(0);
		this._buffer = this._buffer.slice(4);
	}

	if (this._buffer.length >= this._msgLength) {
		var message = this._buffer.slice(0, this._msgLength);
		if (this._buffer.length > this._msgLength) {
			this._buffer = this._buffer.slice(this._msgLength);
		} else {
			this._buffer = null;
		}
		this._msgLength = null;

		try {
			var json = JSON.parse(message);
			this.emit('message', json);
			debug('received ' + message.length + ' bytes');
		} catch (e) {
			console.error("Client sent invalid message:", e);
		}

		if (this._buffer) {
			this._handleMessage();
		}
	}
};

function prepareMessage(msg) {
	var json = JSON.stringify(msg);
	var data = new Buffer(4 + json.length);
	data.writeUInt32BE(json.length, 0);
	data.write(json, 4);
	return data;
}

Singles.prototype.send = function(message) {
	if (!this.socket) return;

	var data = prepareMessage(message);

	if (this.socket instanceof net.Server) {
		// in master mode, broadcast to all
		debug('broadcasting: ' + data.length + ' bytes to ' + this.clients.length + ' clients');
		for (var i in this.clients) {
			this.clients[i].write(data);
		}
	} else {
		// in client mode
		debug('sending ' + data.length + 'bytes');
		this.socket.write(data);
	}
};

Singles.prototype.close = function() {
	if (this.socket) {
		if (this.socket instanceof net.Server) {
			this.socket.close();
		} else {
			this.socket.end();
		}
		this.socket = null;
	}
};
