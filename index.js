"use strict";

var util = require('util');
var EventEmitter = require('events').EventEmitter;
var os = require('os');
var fs = require('fs');
var path = require('path');
var net = require('net');


function Singleton(name) {
	if (!(this instanceof Singleton))
		return new Singleton(name);

	if (typeof name !== 'string')
		throw new Error('Missing Singleton name');

	EventEmitter.call(this);

	this.name = name;

	this.socketPath = path.join(os.tmpdir(), this.name + '.sock');
	this.pidFile = path.join(os.tmpdir(), this.name + '.pid');

	this.socket = null;
	this.master = true;

	process.on('exit', this.close.bind(this));
	process.on('SIGINT', this.close.bind(this));

	if (fs.existsSync(this.pidFile)) {
		var other_pid = Number(fs.readFileSync(this.pidFile).toString());
		console.log('other pid: ' + other_pid);
		if (Singleton.isRunning(other_pid)) {
			this.connect();
			this.master = false;
			return this;
		}
	}

	try {
		fs.unlinkSync(this.socketPath);
	} catch (e) {}

	fs.writeFileSync(this.pidFile, process.pid.toString());

	// Master mode
	this.createServer();
}
util.inherits(Singleton, EventEmitter);
module.exports = Singleton;

Singleton.prototype.connect = function() {
	this.socket = net.connect({ path: this.socketPath });
	this._onConnect(this.socket);
	this.socket.on('close', this.emit.bind(this, 'close'));
};

Singleton.prototype.createServer = function() {
	var self = this;
	this.socket = net.createServer();
	this.socket.on('listening', function() {
		console.log('listening: ' + self.socketPath);
	});
	this.socket.on('connection', this._onConnect.bind(this));
	this.socket.on('error', this.emit.bind(this, 'error'));
	this.socket.on('close', function() {
		console.log("WTF! Closed!!");
	});
	this.socket.listen(this.socketPath);
};

Singleton.prototype._onConnect = function(client) {
	console.log('Client connected');

	client.on('data', this._handleMessage.bind(this));
	client.on('error', this.emit.bind(this, 'error'));
	client.on('end', function() {
		console.log('Client end');
	});
	client.on('close', function() {
		console.log('Client disconnected');
	});
};

Singleton.prototype._handleMessage = function(data) {
	if (!this._buffer) {
		this._buffer = data;
	} else if (data) {
		this._buffer = Buffer.concat([this._buffer, data]);
	}
	console.log('buffer:', this._buffer);

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
		} catch (e) {
			console.log("Client sent invalid message:", e);
		}

		if (this._buffer) {
			this._handleMessage();
		}
	}
};

Singleton.prototype.send = function(message) {
	if (!this.socket) throw new Error('Not connected');

	var json = JSON.stringify(message);
	var data = new Buffer(4 + json.length);
	data.writeUInt32BE(json.length, 0);
	data.write(json, 4);
	this.socket.write(data);
};

Singleton.prototype.close = function() {
	if (this.socket) {
		this.socket.end();
		this.socket = null;
	}
};

Singleton.isRunning = function(pid) {
	try {
		return process.kill(pid, 0);
	} catch (e) {
		return e.code === 'EPERM';
	}
};



