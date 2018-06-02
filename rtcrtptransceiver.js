/*
 *  Copyright (c) 2018 Philipp Hancke. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
/* eslint-env node */
'use strict';

/*
 * a wrapper around the internal transceiver that exposes a
 * spec RTCRtpTransceiver.
 */
module.exports = function() {
  var RTCRtpTransceiver = function(peerConnectionTransceiver) {
    this.peerConnectionTransceiver = peerConnectionTransceiver;
  };
  Object.defineProperty(RTCRtpTransceiver.prototype, 'mid', {
    get: function() {
      return this.peerConnectionTransceiver.mid;
    }
  });

  Object.defineProperty(RTCRtpTransceiver.prototype, 'sender', {
    get: function() {
      return this.peerConnectionTransceiver.rtpSender;
    }
  });

  Object.defineProperty(RTCRtpTransceiver.prototype, 'receiver', {
    get: function() {
      return this.peerConnectionTransceiver.rtpReceiver;
    }
  });

  Object.defineProperty(RTCRtpTransceiver.prototype, 'direction', {
    get: function() {
      return this.peerConnectionTransceiver.direction || 'sendrecv';
    },
    set: function(newDirection) {
      return this.peerConnectionTransceiver.direction = newDirection;
    }
  });
  return RTCRtpTransceiver;
};
