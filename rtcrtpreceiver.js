/*
 *  Copyright (c) 2017 Philipp Hancke. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
/* eslint-env node */
'use strict';

/* a wrapper around Edge's RTCRtpReceiver that does a lazy construction
 * of the native receiver when the transport is available.
 *
 * Note: this does not fix the wrong constructor order of (transport, kind)
 */
module.exports = function(window) {
  var RTCRtpReceiver_ = window.RTCRtpReceiver;
  var RTCRtpReceiver = function(transport, kind) {
    this.kind = kind;
    if (transport) {
      this._receiver = new RTCRtpReceiver_(transport, kind);
    } else {
      this._receiver = null;
    }
  };
  RTCRtpReceiver.getCapabilities = RTCRtpReceiver_.getCapabilities;

  Object.defineProperty(RTCRtpReceiver.prototype, 'transport', {
    get: function() {
      return this._receiver ? this._receiver.transport : null;
    }
  });
  Object.defineProperty(RTCRtpReceiver.prototype, 'track', {
    get: function() {
      return this._receiver ? this._receiver.track : null;
    }
  });

  RTCRtpReceiver.prototype.setTransport = function(transport) {
    if (!this._receiver) {
      this._receiver = new RTCRtpReceiver_(transport, this.kind);
    } else {
      this._receiver.setTransport(transport);
    }
  };

  RTCRtpReceiver.prototype.receive = function(parameters) {
    if (this._receiver) {
      return this._receiver.receive(parameters);
    }
    var e = new Error('Can not call receive in this state');
    e.name = 'InvalidStateError';
    return Promise.reject(e);
  };

  RTCRtpReceiver.prototype.stop = function() {
    if (this._receiver) {
      this._receiver.stop();
    }
  };

  RTCRtpReceiver.prototype.getStats = function() {
    if (this._receiver) {
      return this._receiver.getStats();
    }
    var e = new Error('Can not call getStats in this state');
    e.name = 'InvalidStateError';
    return Promise.reject(e);
  };

  RTCRtpReceiver.prototype.getContributingSources = function() {
    if (!this._receiver) {
      return [];
    }
    return this._receiver.getContributingSources();
  };

  RTCRtpReceiver.prototype.getSynchronizationSources = function() {
    if (!this._receiver) {
      return [];
    }
    return this._receiver.getSynchronizationSources();
  };

  return RTCRtpReceiver;
};
