/*
 *  Copyright (c) 2018 Philipp Hancke. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';
var util = require('./util');

/* a wrapper around Edge's RTCIceTransport that makes it compatible
 * with WebRTC 1.0 which merges RTCIceGatherer and RTCIceTransport.
 *
 * Also hides name changes between Edge and the latest specification.
 */
module.exports = function(window) {
  var prototype = window.RTCIceTransport.prototype;
  // provide getLocalCandidates from gatherer, adding the transport component.
  if (!('getLocalCandidates' in prototype)) {
    prototype.getLocalCandidates = function() {
      var transport = this;
      if (this.iceGatherer) {
        return this.iceGatherer.getLocalCandidates().map(function(cand) {
          cand.component = transport.component;
          return cand;
        });
      }
      return [];
    };
  }

  // provide getLocalParameters from gatherer.
  if (!('getLocalParameters' in prototype)) {
    prototype.getLocalParameters = function() {
      if (this.iceGatherer) {
        return this.iceGatherer.getLocalParameters();
      }
      throw(util.makeError('InvalidStateError',
        'Can not call getLocalParameters in this state'));
    };
  }

  // provide gatheringState and gatheringstatechange from gatherer.
  if (!('gatheringState' in prototype)) {
    Object.defineProperty(prototype, 'gatheringState', {
      get: function() {
        return this.iceGatherer ? this.iceGatherer.state : 'new';
      }
    });
    Object.defineProperty(prototype, 'ongatheringstatechange', {
      get: function() {
        return this._ongatheringstatechange;
      },
      set: function(cb) {
        // TODO: this may loose event subscribes when this.gatherer is null
        //  throw a JS error for now.
        if (this._ongatheringstatechange) {
          this.iceGatherer.removeEventListener('statechange',
            this._ongatheringstatechange);
          delete this._ongatheringstatechange;
        }
        if (cb) {
          this.iceGatherer.addEventListener('statechange',
            this._ongatheringstatechange = cb);
        }
      }
    });

    // implement addEventListener('gatheringstatechange', cb)
    ['addEventListener', 'removeEventListener'].forEach(function(method) {
      var nativeMethod = prototype[method];
      prototype[method] = function(eventName, cb) {
        if (eventName === 'gatheringstatechange') {
          if (this.iceGatherer) {
            return this.iceGatherer[method].apply(this.iceGatherer,
                ['statechange', cb]);
          }
        }
        return nativeMethod.apply(this, arguments);
      };
    });
  }

  // simple name aliases.
  if (!('onstatechange' in prototype)) {
    util.aliasEventListener(prototype,
      'icestatechange', 'statechange');
  }

  if (!('getSelectedCandidatePair' in prototype)) {
    prototype.getSelectedCandidatePair =
    prototype.getSelectedCandidatePair = function() {
      return this.getNominatedCandidatePair();
    };
    util.aliasEventListener(prototype,
      'candidatepairchange', 'selectedcandidatepairchange');
  }
  return window.RTCIceTransport;
};
