/**
 * WebSocket transport. Used in browser in client-mode only. Server
 * handle incoming messages and wrap them into TCP data packets.
 */

"use strict";

var objectAssign = Object.assign || require("object-assign");
var inherits = require("inherits");
var bitmessage = require("bitmessage");
var assert = require("./util").assert;
var BaseTransport = require("./base");

var structs = bitmessage.structs;
var ServicesBitfield = structs.ServicesBitfield;
var messages = bitmessage.messages;
var getmsg = BaseTransport._getmsg;

function WsTransport(opts) {
  WsTransport.super_.call(this);
  objectAssign(this, opts);
  this.seeds = this.seeds || [];
  this.services = this.services || ServicesBitfield().set([
    ServicesBitfield.NODE_MOBILE,
  ]);
  this.streams = this.streams || [1];
}

inherits(WsTransport, BaseTransport);

WsTransport.prototype.bootstrap = function() {
  return Promise.resolve([].concat(this.seeds));
};

WsTransport.prototype.connect = function(url, protocols) {
  var self = this;
  assert(!self._client, "Already connected");

  // TODO(Kagami): Handle timeouts!
  var client = self._client = new WebSocket(url, protocols);
  client.binaryType = "arraybuffer";
  var verackSent = false;
  var verackReceived = false;
  var established = false;

  client.onopen = function() {
    self.emit("open");
    self.send(messages.version.encode({
      services: self.services,
      userAgent: self.userAgent,
      streams: self.streams,
      // This parameters shouldn't be used by the gateway node so we
      // fake it.
      remoteHost: "127.0.0.1",
      remotePort: 8444,
    }));
  };

  client.onmessage = function(e) {
    var buf = new Buffer(new Uint8Array(e.data));
    var decoded;
    try {
      decoded = structs.message.decode(buf);
    } catch (err) {
      return self.emit("warning", new Error(
        "Message decoding error: " + err.message
      ));
    }
    self.emit("message", decoded.command, decoded.payload, decoded);
  };

  // High-level message processing.
  self.on("message", function(command, payload) {
    var version;
    if (!established) {
      if (command === "version") {
        if (verackSent) {
          return;
        }
        try {
          version = self._decodeVersion(payload, {gateway: true});
        } catch(err) {
          self.emit("error", err);
          return client.close();
        }
        self.send("verack");
        verackSent = true;
        if (verackReceived) {
          established = true;
          self.emit("established", version);
        }
      } else if (command === "verack") {
        verackReceived = true;
        if (verackSent) {
          established = true;
          self.emit("established", version);
        }
      }
    }
  });

  client.onerror = function(err) {
    self.emit("error", err);
  };

  client.onclose = function() {
    self.emit("close");
    delete self._client;
  };
};

WsTransport.prototype.send = function() {
  if (this._client) {
    this._client.send(getmsg(arguments));
  } else {
    throw new Error("Not connected");
  }
};

WsTransport.prototype.close = function() {
  if (this._client) {
    this._client.close();
  }
};

module.exports = WsTransport;
