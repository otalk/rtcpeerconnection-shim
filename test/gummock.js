/*
 *  Copyright (c) 2017 Philipp Hancke. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
/* eslint-env node */
const EventEmitter = require('events');
const SDPUtils = require('sdp');

module.exports = function(window) {
  const MediaStream = function(tracks) {
    this.id = SDPUtils.generateIdentifier();
    this._tracks = tracks || [];
  };

  MediaStream.prototype.getTracks = function() {
    return this._tracks;
  };
  MediaStream.prototype.getAudioTracks = function() {
    return this._tracks.filter(t => t.kind === 'audio');
  };
  MediaStream.prototype.getVideoTracks = function() {
    return this._tracks.filter(t => t.kind === 'video');
  };
  MediaStream.prototype.addTrack = function(t) {
    this._tracks.push(t);
  };

  window.MediaStream = MediaStream;

  const MediaStreamTrack = function() {
    this.id = SDPUtils.generateIdentifier();

    this._emitter = new EventEmitter();
    this.addEventListener = this._emitter.addListener.bind(this);
    this.removeEventListener = this._emitter.removeListener.bind(this);
    this.dispatchEvent = (ev) => {
      this._emitter.emit(ev.type, ev);
    };
  };
  MediaStreamTrack.prototype.stop = function() {};
  window.MediaStreamTrack = MediaStreamTrack;


  const getUserMedia = (constraints) => {
    const tracks = [];
    if (constraints.audio) {
      let track = new MediaStreamTrack();
      track.kind = 'audio';
      tracks.push(track);
    }
    if (constraints.video) {
      let track = new MediaStreamTrack();
      track.kind = 'video';
      tracks.push(track);
    }
    const stream = new MediaStream(tracks);
    return new Promise((resolve) => {
      resolve(stream);
    });
  };
  window.navigator = {
    mediaDevices: {
      getUserMedia
    }
  };
};
