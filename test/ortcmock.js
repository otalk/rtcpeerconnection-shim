/*
 *  Copyright (c) 2017 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
/* eslint-env node */
const SDPUtils = require('sdp');
const EventEmitter = require('events');

module.exports = function() {
  // required by the shim to mock an EventEmitter.
  global.document = {
    createDocumentFragment: () => {
      let e = new EventEmitter();
      e.addEventListener = e.addListener.bind(e);
      e.removeEventListener = e.removeListener.bind(e);
      e.dispatchEvent = function(ev) {
        e.emit(ev.type, ev);
      };
      return e;
    }
  };
  global.Event = function(type) {
    this.type = type;
  };

  global.RTCSessionDescription = function(init) {
    return init;
  };

  global.RTCIceGatherer = function() {
    let candidates = [
      {
        foundation: '702786350',
        priority: 41819902,
        protocol: 'udp',
        ip: '8.8.8.8',
        port: 60769,
        type: 'host'
      },
      {}
    ];
    let emittedCandidates = [];
    let emitCandidate = () => {
      let e = new Event('RTCIceGatherEvent');
      e.candidate = candidates.shift();
      emittedCandidates.push(e.candidate);
      if (this.onlocalcandidate) {
        this.onlocalcandidate(e);
      }
      if (candidates.length) {
        setTimeout(emitCandidate, 50);
      }
    };
    setTimeout(emitCandidate, 0);

    this.getLocalCandidates = () => {
      return emittedCandidates;
    };

    this.getLocalParameters = function() {
      return {
        usernameFragment: 'someufrag',
        password: 'somepass'
      };
    };
  };
  global.RTCIceTransport = function() {
    this.start = function() {};
  };
  global.RTCDtlsTransport = function() {
    this.start = function() {};
    this.getLocalParameters = function() {
      return {
        role: 'auto',
        fingerprints: [
          {
            algorithm: 'alg',
            value: 'fi:ng:ger:pr:in:t1'
          }
        ]
      };
    };
  };

  global.RTCRtpReceiver = function(transport, kind) {
    this.track = new MediaStreamTrack();
    this.track.kind = kind;
    this.transport = transport;

    this.receive = function() {};
  };
  function getCapabilities(kind) {
    var opus = {
      name: 'opus',
      kind: 'audio',
      clockRate: 48000,
      preferredPayloadType: 111,
      numChannels: 2
    };
    var vp8 = {
      name: 'vp8',
      kind: 'video',
      clockRate: 90000,
      preferredPayloadType: 100,
      numChannels: 1
    };
    var rtx = {
      name: 'rtx',
      kind: 'video',
      clockRate: 90000,
      preferredPayloadType: 101,
      numChannels: 1,
      parameters: {apt: 100}
    };
    var codecs;
    switch (kind) {
      case 'audio':
        codecs = [opus];
        break;
      case 'video':
        codecs = [vp8, rtx];
        break;
      default:
        codecs = [opus, vp8, rtx];
        break;
    }
    return {
      codecs: codecs,
      headerExtensions: []
    };
  }
  RTCRtpReceiver.getCapabilities = getCapabilities;

  global.RTCRtpSender = function(track, transport) {
    this.track = track;
    this.transport = transport;
    this.send = function() {};
  };
  RTCRtpSender.getCapabilities = getCapabilities;

  global.MediaStream = function(tracks) {
    this.id = SDPUtils.generateIdentifier();
    this._tracks = tracks || [];
    this.getTracks = () => this._tracks;
    this.getAudioTracks = () => this._tracks.filter(t => t.kind === 'audio');
    this.getVideoTracks = () => this._tracks.filter(t => t.kind === 'video');
    this.addTrack = (t) => this._tracks.push(t);
  };
  global.MediaStreamTrack = function() {
    this.id = SDPUtils.generateIdentifier();
  };
};
