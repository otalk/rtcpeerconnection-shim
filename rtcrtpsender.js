/*
 *  Copyright (c) 2017 Philipp Hancke. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';
var util = require('./util');

/* a wrapper around Edge's RTCRtpSender that does a lazy construct of
 * of the native sender when all the required parameters (track and
 * transport) are available.
 */
module.exports = function(window) {
  var RTCRtpSender_ = window.RTCRtpSender;
  var RTCRtpSender = function(trackOrKind, transport) {
    this._sender = null;
    this._track = null;
    this._transport = null;

    if (typeof trackOrKind === 'string') {
      this.kind = trackOrKind;
      this._transport = transport || null;
    } else if (!transport) {
      this._track = trackOrKind;
      this.kind = trackOrKind.kind;
    } else {
      this._sender = new RTCRtpSender_(trackOrKind, transport);
      this.kind = trackOrKind.kind;
    }
    this._isStopped = false;
  };

  // ORTC defines the DTMF sender a bit different.
  // https://github.com/w3c/ortc/issues/714
  Object.defineProperty(RTCRtpSender.prototype, 'dtmf', {
    get: function() {
      if (this._dtmf === undefined) {
        if (this.kind === 'audio') {
          if (!this._sender) {
            throw(util.makeError('InvalidStateError',
                'Can not access dtmf in this state'));
          } else {
            this._dtmf = new window.RTCDtmfSender(this._sender);
          }
        } else if (this.kind === 'video') {
          this._dtmf = null;
        }
      }
      return this._dtmf;
    }
  });

  RTCRtpSender.getCapabilities = RTCRtpSender_.getCapabilities;

  Object.defineProperty(RTCRtpSender.prototype, 'track', {
    get: function() {
      return this._sender ? this._sender.track : this._track;
    }
  });

  Object.defineProperty(RTCRtpSender.prototype, 'transport', {
    get: function() {
      return this._sender ? this._sender.transport : this._transport;
    }
  });

  RTCRtpSender.prototype.setTransport = function(transport) {
    if (!this._sender && this._track) {
      this._sender = new RTCRtpSender_(this._track, transport);
    } else if (this._sender) {
      this._sender.setTransport(transport);
    } else {
      this._transport = transport;
    }
  };

  RTCRtpSender.prototype.replaceTrack = function(track) {
    if (track && this.kind !== track.kind) {
      return Promise.reject(new TypeError());
    }
    if (this._sender) {
      this._sender.replaceTrack(track);
    } else if (track && this._transport) {
      this._sender = new RTCRtpSender_(track, this._transport);
    } else {
      this._track = track;
    }
    return Promise.resolve();
  };

  RTCRtpSender.prototype.setTrack = function(track) { // deprecated.
    if (track && this.kind !== track.kind) {
      return Promise.reject(new TypeError());
    }
    if (this._sender) {
      this._sender.setTrack(track);
    } else if (track && this._transport) {
      this._sender = new RTCRtpSender_(track, this._transport);
    } else {
      this._track = track;
    }
    return Promise.resolve();
  };

  RTCRtpSender.prototype.send = function(parameters) {
    if (this._sender) {
      return this._sender.send(parameters);
    }
    return Promise.reject(util.makeError('InvalidStateError',
        'Can not call send in this state'));
  };

  RTCRtpSender.prototype.stop = function() {
    if (this._sender) {
      this._sender.stop();
    }
  };

  RTCRtpSender.prototype.getStats = function() {
    if (this._sender) {
      return this._sender.getStats();
    }
    return Promise.reject(util.makeError('InvalidStateError',
        'Can not call send in this state'));
  };
  return RTCRtpSender;
};
