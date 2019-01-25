/*
 *  Copyright (c) 2017 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

var SDPUtils = require('sdp');
var shimSenderWithTrackOrKind = require('./rtcrtpsender');
var shimIceGatherer = require('./rtcicegatherer');
var shimIceTransport = require('./rtcicetransport');
var shimDtlsTransport = require('./rtcdtlstransport');
var getCommonCapabilities = require('./getcommoncapabilities');
var writeMediaSection = require('./writemediasection').writeMediaSection;
var writeRejectedMediaSection =
  require('./writemediasection').writeRejectedMediaSection;
var util = require('./util');

module.exports = function(window, edgeVersion) {
  if (window.RTCRtpSender) { // wrap native RTCRtpSender.
    window.RTCRtpSender = shimSenderWithTrackOrKind(window);
  }
  if (window.RTCIceGatherer) { // wrap native RTCIceGatherer.
    window.RTCIceGatherer = shimIceGatherer(window);
  }
  if (window.RTCIceTransport) { // wrap native RTCIceTransport.
    window.RTCIceTransport = shimIceTransport(window);
  }
  if (window.RTCDtlsTransport) { // wrap native RTCDtlsTransport.
    window.RTCDtlsTransport = shimDtlsTransport(window);
  }

  // fix ORTC getStats. Should be moved to adapter.js some day?
  util.fixORTCGetStats(window);

  var RTCPeerConnection = function(config) {
    var pc = this;

    var _eventTarget = document.createDocumentFragment();
    ['addEventListener', 'removeEventListener', 'dispatchEvent']
      .forEach(function(method) {
        pc[method] = _eventTarget[method].bind(_eventTarget);
      });

    this._canTrickleIceCandidates = null;
    this._localDescription = null;
    this._remoteDescription = null;
    this._signalingState = 'stable';
    this._iceConnectionState = 'new';
    this._connectionState = 'new';
    this._iceGatheringState = 'new';

    // per-track iceGathers, iceTransports, dtlsTransports, rtpSenders, ...
    // everything that is needed to describe a SDP m-line.
    this._transceivers = [];

    this._sdpSessionId = SDPUtils.generateSessionId();
    this._sdpSessionVersion = 0;

    this._dtlsRole = undefined; // role for a=setup to use in answers.

    this._isClosed = false;
    this._needNegotiation = false;

    this._localStreams = [];
    this._remoteStreams = [];

    this._usingBundle = config ? config.bundlePolicy === 'max-bundle' : false;
    this._iceGatherers = [];

    // process configuration.
    config = JSON.parse(JSON.stringify(config || {}));
    if (config.rtcpMuxPolicy === 'negotiate') {
      throw util.makeError('NotSupportedError',
        'rtcpMuxPolicy \'negotiate\' is not supported');
    } else if (!config.rtcpMuxPolicy) {
      config.rtcpMuxPolicy = 'require';
    }

    switch (config.iceTransportPolicy) {
      case 'all':
      case 'relay':
        break;
      default:
        config.iceTransportPolicy = 'all';
        break;
    }

    switch (config.bundlePolicy) {
      case 'balanced':
      case 'max-compat':
      case 'max-bundle':
        break;
      default:
        config.bundlePolicy = 'balanced';
        break;
    }

    config.iceServers = util.filterIceServers(config.iceServers || [],
      edgeVersion);

    if (config.iceCandidatePoolSize) {
      for (var i = config.iceCandidatePoolSize; i > 0; i--) {
        this._iceGatherers.push(new window.RTCIceGatherer({
          iceServers: config.iceServers,
          gatherPolicy: config.iceTransportPolicy
        }));
      }
    } else {
      config.iceCandidatePoolSize = 0;
    }

    this._config = config;
  };

  // set up public properties on the prototype
  ['localDescription', 'remoteDescription', 'signalingState',
    'iceConnectionState', 'connectionState', 'iceGatheringState',
    'canTrickleIceCandidates'].forEach(function(propertyName) {
    Object.defineProperty(RTCPeerConnection.prototype, propertyName, {
      configurable: true,
      get: function() {
        return this['_' + propertyName];
      }
    });
  });

  // set up event handlers on prototype
  ['icecandidate', 'addstream', 'removestream', 'track',
    'signalingstatechange', 'iceconnectionstatechange',
    'connectionstatechange', 'icegatheringstatechange',
    'negotiationneeded', 'datachannel'].forEach(function(eventName) {
    RTCPeerConnection.prototype['on' + eventName] = null;
  });

  // internal helper to create a transceiver object.
  // (which is not yet the same as the WebRTC 1.0 transceiver)
  RTCPeerConnection.prototype._createTransceiver = function(kind, doNotAdd) {
    var hasBundleTransport = this._transceivers.length > 0;
    var transceiver = {
      track: null,
      iceGatherer: null,
      iceTransport: null,
      dtlsTransport: null,
      localCapabilities: null,
      remoteCapabilities: null,
      rtpSender: null,
      rtpReceiver: null,
      kind: kind,
      mid: null,
      sendEncodingParameters: null,
      recvEncodingParameters: null,
      stream: null,
      associatedRemoteMediaStreams: [],
      wantReceive: true
    };
    if (this._usingBundle && hasBundleTransport) {
      transceiver.iceTransport = this._transceivers[0].iceTransport;
      transceiver.dtlsTransport = this._transceivers[0].dtlsTransport;
    } else {
      var transports = this._createIceAndDtlsTransports();
      transceiver.iceTransport = transports.iceTransport;
      transceiver.dtlsTransport = transports.dtlsTransport;
    }
    if (!doNotAdd) {
      this._transceivers.push(transceiver);
    }
    return transceiver;
  };

  RTCPeerConnection.prototype._createIceGatherer = function(transceiver,
    usingBundle) {
    if (usingBundle && transceiver.sdpMLineIndex > 0) {
      return this._transceivers[0].iceGatherer;
    } else if (this._iceGatherers.length) {
      return this._iceGatherers.shift();
    }
    var iceGatherer = new window.RTCIceGatherer({
      iceServers: this._config.iceServers,
      gatherPolicy: this._config.iceTransportPolicy
    });
    return iceGatherer;
  };

  // start gathering from an RTCIceGatherer.
  RTCPeerConnection.prototype._gather = function(transceiver) {
    var pc = this;
    var mid = transceiver.mid;
    var sdpMLineIndex = transceiver.sdpMLineIndex;
    var iceGatherer = transceiver.iceGatherer;
    if (iceGatherer.onlocalcandidate) {
      return;
    }
    iceGatherer.onlocalcandidate = function(evt) {
      if (pc._usingBundle && sdpMLineIndex > 0) {
        // if we know that we use bundle we can drop candidates with
        // ѕdpMLineIndex > 0. If we don't do this then our state gets
        // confused since we dispose the extra ice gatherer.
        return;
      }
      var event = new Event('icecandidate');
      event.candidate = {sdpMid: mid, sdpMLineIndex: sdpMLineIndex};

      var cand = evt.candidate;
      // Edge emits an empty object for RTCIceCandidateComplete‥
      var end = !cand || Object.keys(cand).length === 0;
      if (!end) {
        // RTCIceCandidate doesn't have a component, needs to be added
        cand.component = 1;
        // also the usernameFragment.
        cand.usernameFragment =
          iceGatherer.getLocalParameters().usernameFragment;

        var serializedCandidate = SDPUtils.writeCandidate(cand);
        event.candidate = Object.assign(event.candidate,
          SDPUtils.parseCandidate(serializedCandidate));

        event.candidate.candidate = serializedCandidate;
        event.candidate.toJSON = function() {
          return {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            usernameFragment: event.candidate.usernameFragment
          };
        };
      }

      // update local description.
      var sections = SDPUtils.getMediaSections(pc._localDescription.sdp);
      if (!end) {
        sections[event.candidate.sdpMLineIndex] +=
            'a=' + event.candidate.candidate + '\r\n';
      } else {
        sections[event.candidate.sdpMLineIndex] +=
            'a=end-of-candidates\r\n';
      }
      pc._localDescription.sdp =
          SDPUtils.getDescription(pc._localDescription.sdp) +
          sections.join('');

      if (!end) { // Emit candidate.
        pc._updateIceGatheringState('gathering');
        pc._dispatchEvent('icecandidate', event);
      }

      var complete = pc._transceivers.every(function(t) {
        return t.iceGatherer && t.iceGatherer.state === 'complete';
      });
      if (complete) {
        pc._updateIceGatheringState('complete');
      }
    };

    // emit already gathered candidates.
    var gatheredCandidates = iceGatherer.getLocalCandidates();
    var isComplete = iceGatherer.state === 'complete';
    window.setTimeout(function() {
      if (!iceGatherer.onlocalcandidate) {
        return;
      }
      gatheredCandidates.forEach(iceGatherer.onlocalcandidate);
      if (isComplete) {
        iceGatherer.onlocalcandidate({candidate: {}});
      }
    }, 0);
  };

  // Create ICE transport and DTLS transport.
  RTCPeerConnection.prototype._createIceAndDtlsTransports = function() {
    var pc = this;
    var iceTransport = new window.RTCIceTransport(null);
    iceTransport.addEventListener('statechange', function() {
      pc._updateIceConnectionState();
      pc._updateConnectionState();
    });

    var dtlsTransport = new window.RTCDtlsTransport(iceTransport);
    dtlsTransport.addEventListener('statechange', function() {
      pc._updateConnectionState();
    });
    dtlsTransport.addEventListener('error', function() {
      // onerror does not set state to failed by itself.
      Object.defineProperty(dtlsTransport, 'state',
        {value: 'failed', writable: true});
      pc._updateConnectionState();
    });

    return {
      iceTransport: iceTransport,
      dtlsTransport: dtlsTransport
    };
  };

  // Destroy ICE gatherer, ICE transport and DTLS transport.
  // Without triggering the callbacks.
  RTCPeerConnection.prototype._disposeIceAndDtlsTransports = function(
    transceiver) {
    var iceGatherer = transceiver.iceGatherer;
    if (iceGatherer) {
      delete iceGatherer.onlocalcandidate;
      delete transceiver.iceGatherer;
    }
    delete transceiver.iceTransport;

    delete transceiver.dtlsTransport;
  };

  // Start the RTP Sender and Receiver for a transceiver.
  RTCPeerConnection.prototype._transceive = function(transceiver,
    send, recv) {
    var params = getCommonCapabilities(transceiver.localCapabilities,
      transceiver.remoteCapabilities);
    if (send && transceiver.rtpSender) {
      params.encodings = transceiver.sendEncodingParameters;
      params.rtcp = {
        cname: SDPUtils.localCName,
        compound: transceiver.rtcpParameters.compound
      };
      if (transceiver.recvEncodingParameters.length) {
        params.rtcp.ssrc = transceiver.recvEncodingParameters[0].ssrc;
      }
      transceiver.rtpSender.send(params);
    }
    if (recv && transceiver.rtpReceiver && params.codecs.length > 0) {
      // remove RTX field in Edge 14942
      if (transceiver.kind === 'video'
          && transceiver.recvEncodingParameters
          && edgeVersion < 15019) {
        transceiver.recvEncodingParameters.forEach(function(p) {
          delete p.rtx;
        });
      }
      if (transceiver.recvEncodingParameters.length) {
        params.encodings = transceiver.recvEncodingParameters;
      } else {
        params.encodings = [{}];
      }
      params.rtcp = {
        compound: transceiver.rtcpParameters.compound
      };
      if (transceiver.rtcpParameters.cname) {
        params.rtcp.cname = transceiver.rtcpParameters.cname;
      }
      if (transceiver.sendEncodingParameters.length) {
        params.rtcp.ssrc = transceiver.sendEncodingParameters[0].ssrc;
      }
      transceiver.rtpReceiver.receive(params);
    }
  };

  // Update the signaling state.
  RTCPeerConnection.prototype._updateSignalingState = function(newState) {
    if (newState === this._signalingState) {
      return;
    }
    this._signalingState = newState;
    var event = new Event('signalingstatechange');
    this._dispatchEvent('signalingstatechange', event);
  };

  // Determine whether to fire the negotiationneeded event.
  RTCPeerConnection.prototype._maybeFireNegotiationNeeded = function() {
    var pc = this;
    if (this._signalingState !== 'stable' || this._needNegotiation === true) {
      return;
    }
    this._needNegotiation = true;
    window.setTimeout(function() {
      if (pc._needNegotiation) {
        pc._needNegotiation = false;
        var event = new Event('negotiationneeded');
        pc._dispatchEvent('negotiationneeded', event);
      }
    }, 0);
  };

  // Update the ice gathering state. See
  // https://w3c.github.io/webrtc-pc/#update-the-ice-gathering-state
  RTCPeerConnection.prototype._updateIceGatheringState = function(newState) {
    if (newState === this._iceGatheringState) {
      return;
    }
    this._iceGatheringState = newState;

    var event = new Event('icegatheringstatechange');
    this._dispatchEvent('icegatheringstatechange', event);

    if (newState === 'complete') {
      this._dispatchEvent('icecandidate', new Event('icecandidate'));
    }
  };

  // Update the ice connection state.
  RTCPeerConnection.prototype._updateIceConnectionState = function() {
    var newState;
    var states = {
      'new': 0,
      closed: 0,
      checking: 0,
      connected: 0,
      completed: 0,
      disconnected: 0,
      failed: 0
    };
    this._transceivers.forEach(function(transceiver) {
      if (transceiver.iceTransport && !transceiver.rejected) {
        states[transceiver.iceTransport.state]++;
      }
    });

    newState = 'new';
    if (states.failed > 0) {
      newState = 'failed';
    } else if (states.checking > 0) {
      newState = 'checking';
    } else if (states.disconnected > 0) {
      newState = 'disconnected';
    } else if (states.new > 0) {
      newState = 'new';
    } else if (states.connected > 0) {
      newState = 'connected';
    } else if (states.completed > 0) {
      newState = 'completed';
    }

    if (newState !== this._iceConnectionState) {
      this._iceConnectionState = newState;
      var event = new Event('iceconnectionstatechange');
      this._dispatchEvent('iceconnectionstatechange', event);
    }
  };

  // Update the connection state.
  RTCPeerConnection.prototype._updateConnectionState = function() {
    var newState;
    var states = {
      'new': 0,
      closed: 0,
      connecting: 0,
      connected: 0,
      completed: 0,
      disconnected: 0,
      failed: 0
    };
    this._transceivers.forEach(function(transceiver) {
      if (transceiver.iceTransport && transceiver.dtlsTransport &&
          !transceiver.rejected) {
        states[transceiver.iceTransport.state]++;
        states[transceiver.dtlsTransport.state]++;
      }
    });
    // ICETransport.completed and connected are the same for this purpose.
    states.connected += states.completed;

    newState = 'new';
    if (states.failed > 0) {
      newState = 'failed';
    } else if (states.connecting > 0) {
      newState = 'connecting';
    } else if (states.disconnected > 0) {
      newState = 'disconnected';
    } else if (states.new > 0) {
      newState = 'new';
    } else if (states.connected > 0) {
      newState = 'connected';
    }

    if (newState !== this._connectionState) {
      this._connectionState = newState;
      var event = new Event('connectionstatechange');
      this._dispatchEvent('connectionstatechange', event);
    }
  };

  RTCPeerConnection.prototype._dispatchEvent = function(name, event) {
    if (this._isClosed) {
      return;
    }
    this.dispatchEvent(event);
    if (typeof this['on' + name] === 'function') {
      this['on' + name](event);
    }
  };

  RTCPeerConnection.prototype._emitTrack = function(track, receiver, streams) {
    var pc = this;
    var trackEvent = new Event('track');
    trackEvent.track = track;
    trackEvent.receiver = receiver;
    trackEvent.transceiver = {receiver: receiver};
    trackEvent.streams = streams;
    pc._dispatchEvent('track', trackEvent);
  };


  RTCPeerConnection.prototype.getConfiguration = function() {
    return this._config;
  };

  RTCPeerConnection.prototype.getLocalStreams = function() {
    return this._localStreams;
  };

  RTCPeerConnection.prototype.getRemoteStreams = function() {
    return this._remoteStreams;
  };

  RTCPeerConnection.prototype.addTrack = function(track, stream) {
    if (this._isClosed) {
      throw util.makeError('InvalidStateError',
        'Attempted to call addTrack on a closed peerconnection.');
    }

    var alreadyExists = this._transceivers.find(function(s) {
      return s.track === track;
    });

    if (alreadyExists) {
      throw util.makeError('InvalidAccessError', 'Track already exists.');
    }

    var transceiver;
    for (var i = 0; i < this._transceivers.length; i++) {
      if (!this._transceivers[i].track &&
          this._transceivers[i].kind === track.kind) {
        transceiver = this._transceivers[i];
      }
    }
    if (!transceiver) {
      transceiver = this._createTransceiver(track.kind);
    }

    this._maybeFireNegotiationNeeded();

    if (this._localStreams.indexOf(stream) === -1) {
      this._localStreams.push(stream);
    }

    transceiver.track = track;
    transceiver.stream = stream;
    transceiver.rtpSender = new window.RTCRtpSender(track);
    return transceiver.rtpSender;
  };

  RTCPeerConnection.prototype.addStream = function(stream) {
    var pc = this;
    if (edgeVersion >= 15025) {
      stream.getTracks().forEach(function(track) {
        pc.addTrack(track, stream);
      });
    } else {
      // Clone is necessary for local demos mostly, attaching directly
      // to two different senders does not work (build 10547).
      // Fixed in 15025 (or earlier)
      var clonedStream = stream.clone();
      stream.getTracks().forEach(function(track, idx) {
        var clonedTrack = clonedStream.getTracks()[idx];
        track.addEventListener('enabled', function(event) {
          clonedTrack.enabled = event.enabled;
        });
      });
      clonedStream.getTracks().forEach(function(track) {
        pc.addTrack(track, clonedStream);
      });
    }
  };

  RTCPeerConnection.prototype.removeTrack = function(sender) {
    if (this._isClosed) {
      throw util.makeError('InvalidStateError',
        'Attempted to call removeTrack on a closed peerconnection.');
    }

    if (!(sender instanceof window.RTCRtpSender)) {
      throw new TypeError('Argument 1 of RTCPeerConnection.removeTrack ' +
          'does not implement interface RTCRtpSender.');
    }

    var transceiver = this._transceivers.find(function(t) {
      return t.rtpSender === sender;
    });

    if (!transceiver) {
      throw util.makeError('InvalidAccessError',
        'Sender was not created by this connection.');
    }
    var stream = transceiver.stream;

    transceiver.rtpSender.stop();
    transceiver.rtpSender = null;
    transceiver.track = null;
    transceiver.stream = null;

    // remove the stream from the set of local streams
    var localStreams = this._transceivers.map(function(t) {
      return t.stream;
    });
    if (localStreams.indexOf(stream) === -1 &&
        this._localStreams.indexOf(stream) > -1) {
      this._localStreams.splice(this._localStreams.indexOf(stream), 1);
    }

    this._maybeFireNegotiationNeeded();
  };

  RTCPeerConnection.prototype.removeStream = function(stream) {
    var pc = this;
    stream.getTracks().forEach(function(track) {
      var sender = pc.getSenders().find(function(s) {
        return s.track === track;
      });
      if (sender) {
        pc.removeTrack(sender);
      }
    });
  };

  RTCPeerConnection.prototype.getSenders = function() {
    return this._transceivers.filter(function(transceiver) {
      return !!transceiver.rtpSender;
    })
      .map(function(transceiver) {
        return transceiver.rtpSender;
      });
  };

  RTCPeerConnection.prototype.getReceivers = function() {
    return this._transceivers.filter(function(transceiver) {
      return !!transceiver.rtpReceiver;
    })
      .map(function(transceiver) {
        return transceiver.rtpReceiver;
      });
  };

  RTCPeerConnection.prototype.setLocalDescription = function(description) {
    var pc = this;

    // Note: pranswer is not supported.
    if (['offer', 'answer'].indexOf(description.type) === -1) {
      return Promise.reject(util.makeError('TypeError',
        'Unsupported type "' + description.type + '"'));
    }

    if (!util.isActionAllowedInSignalingState('setLocalDescription',
      description.type, pc._signalingState) || pc._isClosed) {
      return Promise.reject(util.makeError('InvalidStateError',
        'Can not set local ' + description.type +
          ' in state ' + pc._signalingState));
    }

    var sections;
    var sessionpart;
    if (description.type === 'offer') {
      // VERY limited support for SDP munging. Limited to:
      // * changing the order of codecs
      sections = SDPUtils.splitSections(description.sdp);
      sessionpart = sections.shift();
      sections.forEach(function(mediaSection, sdpMLineIndex) {
        var caps = SDPUtils.parseRtpParameters(mediaSection);
        var transceiver = pc._transceivers.find(function(t) {
          return t.mid === SDPUtils.getMid(mediaSection);
        });
        transceiver.localCapabilities = caps;
      });

      pc._transceivers.forEach(function(transceiver) {
        pc._gather(transceiver);
      });
    } else if (description.type === 'answer') {
      sections = SDPUtils.splitSections(pc._remoteDescription.sdp);
      sessionpart = sections.shift();
      var isIceLite = SDPUtils.matchPrefix(sessionpart,
        'a=ice-lite').length > 0;
      sections.forEach(function(mediaSection, sdpMLineIndex) {
        var transceiver = pc._transceivers.find(function(t) {
          return t.mid === SDPUtils.getMid(mediaSection);
        });
        var iceGatherer = transceiver.iceGatherer;
        var iceTransport = transceiver.iceTransport;
        var dtlsTransport = transceiver.dtlsTransport;
        var localCapabilities = transceiver.localCapabilities;
        var remoteCapabilities = transceiver.remoteCapabilities;

        // treat bundle-only as not-rejected.
        var rejected = SDPUtils.isRejected(mediaSection) &&
            SDPUtils.matchPrefix(mediaSection, 'a=bundle-only').length === 0;

        if (!rejected && !transceiver.rejected) {
          if (transceiver.rtpSender && !transceiver.rtpSender.transport) {
            transceiver.rtpSender.setTransport(transceiver.dtlsTransport);
          }
          var remoteIceParameters = SDPUtils.getIceParameters(
            mediaSection, sessionpart);
          var remoteDtlsParameters = SDPUtils.getDtlsParameters(
            mediaSection, sessionpart);
          if (isIceLite) {
            remoteDtlsParameters.role = 'server';
          }

          if (!pc._usingBundle || sdpMLineIndex === 0) {
            pc._gather(transceiver);
            if (iceTransport.state === 'new') {
              iceTransport.start(iceGatherer, remoteIceParameters,
                isIceLite ? 'controlling' : 'controlled');
            }
            if (dtlsTransport.state === 'new') {
              dtlsTransport.start(remoteDtlsParameters);
            }
          }

          // Calculate intersection of capabilities.
          var params = getCommonCapabilities(localCapabilities,
            remoteCapabilities);

          // Start the RTCRtpSender. The RTCRtpReceiver for this
          // transceiver has already been started in setRemoteDescription.
          pc._transceive(transceiver,
            params.codecs.length > 0,
            false);
        }
      });
    }

    pc._localDescription = {
      type: description.type,
      sdp: description.sdp
    };
    if (description.type === 'offer') {
      pc._updateSignalingState('have-local-offer');
    } else {
      pc._updateSignalingState('stable');
    }

    return Promise.resolve();
  };

  RTCPeerConnection.prototype.setRemoteDescription = function(description) {
    var pc = this;

    // Note: pranswer is not supported.
    if (['offer', 'answer'].indexOf(description.type) === -1) {
      return Promise.reject(util.makeError('TypeError',
        'Unsupported type "' + description.type + '"'));
    }

    if (!util.isActionAllowedInSignalingState('setRemoteDescription',
      description.type, pc._signalingState) || pc._isClosed) {
      return Promise.reject(util.makeError('InvalidStateError',
        'Can not set remote ' + description.type +
          ' in state ' + pc._signalingState));
    }

    // TODO: should be RTCError instead. But for that it would have to
    // give a line. And we need an RTCError shim.
    if (!SDPUtils.isValidSDP(description.sdp)) {
      return Promise.reject(util.makeError('InvalidAccessError',
        'My parser failed on this SDP, ' +
        'which means that one of the two is buggy.'));
    }

    var sections = SDPUtils.splitSections(description.sdp);
    var sessionpart = sections.shift();

    var usesMux = true;
    sections.forEach(function(mediaSection, sdpMLineIndex) {
      var kind = SDPUtils.getKind(mediaSection);
      var rejected = SDPUtils.isRejected(mediaSection) &&
          SDPUtils.matchPrefix(mediaSection, 'a=bundle-only').length === 0;
      if (!(kind === 'audio' || kind === 'video') || rejected) {
        return;
      }
      usesMux &= SDPUtils.matchPrefix(mediaSection, 'a=rtcp-mux').length > 0;
    });
    if (!usesMux) {
      return Promise.reject(util.makeError('InvalidAccessError',
        'rtcp-mux is required.'));
    }

    var streams = {};
    pc._remoteStreams.forEach(function(stream) {
      streams[stream.id] = stream;
    });
    var receiverList = [];
    var isIceLite = SDPUtils.matchPrefix(sessionpart,
      'a=ice-lite').length > 0;
    var usingBundle = SDPUtils.matchPrefix(sessionpart,
      'a=group:BUNDLE ').length > 0;
    pc._usingBundle = usingBundle;
    var iceOptions = SDPUtils.matchPrefix(sessionpart,
      'a=ice-options:')[0];
    if (iceOptions) {
      pc._canTrickleIceCandidates = iceOptions.substr(14).split(' ')
        .indexOf('trickle') >= 0;
    } else {
      pc._canTrickleIceCandidates = false;
    }

    sections.forEach(function(mediaSection, sdpMLineIndex) {
      var lines = SDPUtils.splitLines(mediaSection);
      var kind = SDPUtils.getKind(mediaSection);
      // treat bundle-only as not-rejected.
      var rejected = SDPUtils.isRejected(mediaSection) &&
          SDPUtils.matchPrefix(mediaSection, 'a=bundle-only').length === 0;
      var protocol = lines[0].substr(2).split(' ')[2];

      var direction = SDPUtils.getDirection(mediaSection, sessionpart);
      var remoteMsid = SDPUtils.parseMsid(mediaSection);

      var mid = SDPUtils.getMid(mediaSection) || SDPUtils.generateIdentifier();

      var transceiver;
      transceiver = pc._transceivers.find(function(t) {
        return t.mid === mid;
      });
      if (!transceiver) {
        // TODO: only do this for offers? If in an answer reject.
        //
        // Search for a matching transceiver with the same kind that is not
        // associated yet.
        transceiver = pc._transceivers.find(function(t) {
          return t.kind === kind && t.sdpMLineIndex === undefined;
        });
        if (transceiver) {
          transceiver.sdpMLineIndex = sdpMLineIndex;
        }
      }

      // Reject datachannels which are not implemented yet.
      if (rejected || (kind === 'application' && (protocol === 'DTLS/SCTP' ||
          protocol === 'UDP/DTLS/SCTP'))) {
        // TODO: this is dangerous in the case where a non-rejected m-line
        //     becomes rejected.
        if (!transceiver) {
          pc._transceivers.push({
            mid: mid,
            kind: kind,
            protocol: protocol,
            sdpMLineIndex: sdpMLineIndex,
            rejected: true
          });
        }
        return;
      }

      if (!rejected && (transceiver && transceiver.rejected)) {
        // recycle a rejected transceiver.
        pc._transceivers[transceiver.sdpMLineIndex] =
          pc._createTransceiver(kind, true);
        transceiver = pc._transceivers[sdpMLineIndex];
        transceiver.sdpMLineIndex = sdpMLineIndex;
      }
      if (description.type === 'offer' && !transceiver) {
        transceiver = pc._createTransceiver(kind);
        transceiver.sdpMLineIndex = sdpMLineIndex;
      }

      var iceGatherer;
      var iceTransport;
      var dtlsTransport;
      var rtpReceiver;
      var sendEncodingParameters;
      var recvEncodingParameters;
      var localCapabilities;

      var track;
      var remoteCapabilities = SDPUtils.parseRtpParameters(mediaSection);
      var remoteIceParameters;
      var remoteDtlsParameters;
      if (!rejected) {
        remoteIceParameters = SDPUtils.getIceParameters(mediaSection,
          sessionpart);
        remoteDtlsParameters = SDPUtils.getDtlsParameters(mediaSection,
          sessionpart);
        remoteDtlsParameters.role = 'client';
      }
      recvEncodingParameters =
          SDPUtils.parseRtpEncodingParameters(mediaSection);

      var rtcpParameters = SDPUtils.parseRtcpParameters(mediaSection);

      var isComplete = SDPUtils.matchPrefix(mediaSection,
        'a=end-of-candidates', sessionpart).length > 0;
      var cands = SDPUtils.matchPrefix(mediaSection, 'a=candidate:')
        .map(function(cand) {
          return SDPUtils.parseCandidate(cand);
        })
        .filter(function(cand) {
          return cand.component === 1;
        });

      // Check if we can use BUNDLE and dispose transports.
      if ((description.type === 'offer' || description.type === 'answer') &&
          !rejected && usingBundle && sdpMLineIndex > 0 && transceiver) {
        pc._disposeIceAndDtlsTransports(transceiver);
        // TODO: this needs to search for the transceiver with
        // sdpMLinexIndex 0, not the transceiver at [0]
        transceiver.iceGatherer = pc._transceivers[0].iceGatherer;
        transceiver.iceTransport = pc._transceivers[0].iceTransport;
        transceiver.dtlsTransport = pc._transceivers[0].dtlsTransport;
        if (transceiver.rtpSender) {
          transceiver.rtpSender.setTransport(
            pc._transceivers[0].dtlsTransport);
        }
        if (transceiver.rtpReceiver) {
          transceiver.rtpReceiver.setTransport(
            pc._transceivers[0].dtlsTransport);
        }
      }
      if (description.type === 'offer' && !rejected) {
        transceiver.mid = mid;

        if (!transceiver.iceGatherer) {
          transceiver.iceGatherer = pc._createIceGatherer(
            transceiver, usingBundle);
        }

        if (cands.length && transceiver.iceTransport.state === 'new') {
          if (isComplete && (!usingBundle || sdpMLineIndex === 0)) {
            transceiver.iceTransport.setRemoteCandidates(cands);
          } else {
            cands.forEach(function(candidate) {
              util.maybeAddCandidate(transceiver.iceTransport, candidate);
            });
          }
        }

        localCapabilities = window.RTCRtpReceiver.getCapabilities(kind);

        // filter RTX until additional stuff needed for RTX is implemented
        // in adapter.js
        if (edgeVersion < 15019) {
          localCapabilities.codecs = localCapabilities.codecs.filter(
            function(codec) {
              return codec.name !== 'rtx';
            });
        }

        sendEncodingParameters = transceiver.sendEncodingParameters || [{
          ssrc: (2 * sdpMLineIndex + 2) * 1001
        }];

        // TODO: rewrite to use http://w3c.github.io/webrtc-pc/#set-associated-remote-streams
        var isNewTrack = false;
        if (direction === 'sendrecv' || direction === 'sendonly') {
          isNewTrack = !transceiver.rtpReceiver;
          rtpReceiver = transceiver.rtpReceiver ||
              new window.RTCRtpReceiver(transceiver.dtlsTransport, kind);

          if (isNewTrack) {
            var stream;
            track = rtpReceiver.track;
            // FIXME: does not work with Plan B.
            if (remoteMsid && remoteMsid.stream === '-') {
              // no-op. a stream id of '-' means: no associated stream.
            } else if (remoteMsid) {
              if (!streams[remoteMsid.stream]) {
                streams[remoteMsid.stream] = new window.MediaStream();
                Object.defineProperty(streams[remoteMsid.stream], 'id', {
                  get: function() {
                    return remoteMsid.stream;
                  }
                });
              }
              Object.defineProperty(track, 'id', {
                get: function() {
                  return remoteMsid.track;
                }
              });
              stream = streams[remoteMsid.stream];
            } else {
              if (!streams.default) {
                streams.default = new window.MediaStream();
              }
              stream = streams.default;
            }
            if (stream) {
              util.addTrackToStreamAndFireEvent(track, stream);
              transceiver.associatedRemoteMediaStreams.push(stream);
            }
            receiverList.push([track, rtpReceiver, stream]);
          }
        } else if (transceiver.rtpReceiver && transceiver.rtpReceiver.track) {
          transceiver.associatedRemoteMediaStreams.forEach(function(s) {
            var nativeTrack = s.getTracks().find(function(t) {
              return t.id === transceiver.rtpReceiver.track.id;
            });
            if (nativeTrack) {
              util.removeTrackFromStreamAndFireEvent(nativeTrack, s);
            }
          });
          transceiver.associatedRemoteMediaStreams = [];
        }

        transceiver.localCapabilities = localCapabilities;
        transceiver.remoteCapabilities = remoteCapabilities;
        transceiver.rtpReceiver = rtpReceiver;
        transceiver.rtcpParameters = rtcpParameters;
        transceiver.sendEncodingParameters = sendEncodingParameters;
        transceiver.recvEncodingParameters = recvEncodingParameters;
        transceiver.sdpMLineIndex = sdpMLineIndex;

        // Start the RTCRtpReceiver now. The RTPSender is started in
        // setLocalDescription.
        pc._transceive(transceiver, false, isNewTrack);
      } else if (description.type === 'answer' && !rejected) {
        iceGatherer = transceiver.iceGatherer;
        iceTransport = transceiver.iceTransport;
        dtlsTransport = transceiver.dtlsTransport;
        rtpReceiver = transceiver.rtpReceiver;
        sendEncodingParameters = transceiver.sendEncodingParameters;
        localCapabilities = transceiver.localCapabilities;

        transceiver.recvEncodingParameters = recvEncodingParameters;
        transceiver.remoteCapabilities = remoteCapabilities;
        transceiver.rtcpParameters = rtcpParameters;

        if (cands.length && iceTransport.state === 'new') {
          if ((isIceLite || isComplete) &&
              (!usingBundle || sdpMLineIndex === 0)) {
            iceTransport.setRemoteCandidates(cands);
          } else {
            cands.forEach(function(candidate) {
              util.maybeAddCandidate(transceiver.iceTransport, candidate);
            });
          }
        }

        if (!usingBundle || sdpMLineIndex === 0) {
          if (iceTransport.state === 'new') {
            iceTransport.start(iceGatherer, remoteIceParameters,
              'controlling');
          }
          if (dtlsTransport.state === 'new') {
            dtlsTransport.start(remoteDtlsParameters);
          }
        }
        if (transceiver.rtpSender && !transceiver.rtpSender.transport) {
          transceiver.rtpSender.setTransport(transceiver.dtlsTransport);
        }

        // If the offer contained RTX but the answer did not,
        // remove RTX from sendEncodingParameters.
        var commonCapabilities = getCommonCapabilities(
          transceiver.localCapabilities,
          transceiver.remoteCapabilities);

        var hasRtx = commonCapabilities.codecs.filter(function(c) {
          return c.name.toLowerCase() === 'rtx';
        }).length;
        if (!hasRtx && transceiver.sendEncodingParameters[0].rtx) {
          delete transceiver.sendEncodingParameters[0].rtx;
        }

        pc._transceive(transceiver,
          direction === 'sendrecv' || direction === 'recvonly',
          direction === 'sendrecv' || direction === 'sendonly');

        // TODO: rewrite to use http://w3c.github.io/webrtc-pc/#set-associated-remote-streams
        if (rtpReceiver &&
            (direction === 'sendrecv' || direction === 'sendonly')) {
          track = rtpReceiver.track;
          if (remoteMsid) {
            if (!streams[remoteMsid.stream]) {
              streams[remoteMsid.stream] = new window.MediaStream();
            }
            util.addTrackToStreamAndFireEvent(track,
              streams[remoteMsid.stream]);
            receiverList.push([track, rtpReceiver, streams[remoteMsid.stream]]);
          } else {
            if (!streams.default) {
              streams.default = new window.MediaStream();
            }
            util.addTrackToStreamAndFireEvent(track, streams.default);
            receiverList.push([track, rtpReceiver, streams.default]);
          }
        } else {
          // FIXME: actually the receiver should be created later.
          delete transceiver.rtpReceiver;
        }
      }
    });

    if (pc._dtlsRole === undefined) {
      pc._dtlsRole = description.type === 'offer' ? 'active' : 'passive';
    }

    pc._remoteDescription = {
      type: description.type,
      sdp: description.sdp
    };
    if (description.type === 'offer') {
      pc._updateSignalingState('have-remote-offer');
    } else {
      pc._updateSignalingState('stable');
    }
    Object.keys(streams).forEach(function(sid) {
      var stream = streams[sid];
      if (stream.getTracks().length) {
        if (pc._remoteStreams.indexOf(stream) === -1) {
          pc._remoteStreams.push(stream);
          var event = new Event('addstream');
          event.stream = stream;
          pc._dispatchEvent('addstream', event);
        }

        receiverList.forEach(function(item) {
          var track = item[0];
          var receiver = item[1];
          if (stream.id !== item[2].id) {
            return;
          }
          pc._emitTrack(track, receiver, [stream]);
        });
      }
    });
    receiverList.forEach(function(item) {
      if (item[2]) {
        return;
      }
      pc._emitTrack(item[0], item[1], []);
    });

    // check whether addIceCandidate({}) was called within four seconds after
    // setRemoteDescription.
    window.setTimeout(function() {
      if (!(pc && pc._transceivers) || pc._isClosed) {
        return;
      }
      pc._transceivers.forEach(function(transceiver) {
        if (transceiver.iceTransport &&
            transceiver.iceTransport.state === 'new' &&
            transceiver.iceTransport.getRemoteCandidates().length > 0) {
          console.warn('Timeout for addRemoteCandidate. Consider sending ' +
              'an end-of-candidates notification');
          transceiver.iceTransport.addRemoteCandidate({});
        }
      });
    }, 4000);

    return Promise.resolve();
  };

  RTCPeerConnection.prototype.close = function() {
    this._transceivers.forEach(function(transceiver) {
      /* not yet
      if (transceiver.iceGatherer) {
        transceiver.iceGatherer.close();
      }
      */
      if (transceiver.iceTransport) {
        transceiver.iceTransport.stop();
      }
      if (transceiver.dtlsTransport) {
        transceiver.dtlsTransport.stop();
      }
      if (transceiver.rtpSender) {
        transceiver.rtpSender.stop();
      }
      if (transceiver.rtpReceiver) {
        transceiver.rtpReceiver.stop();
      }
    });
    // FIXME: clean up tracks, local streams, remote streams, etc
    this._isClosed = true;
    this._updateSignalingState('closed');
    this._iceConnectionState = 'closed';
    this._connectionState = 'closed';
  };

  RTCPeerConnection.prototype.createOffer = function() {
    var pc = this;

    if (pc._isClosed) {
      return Promise.reject(util.makeError('InvalidStateError',
        'Can not call createOffer after close'));
    }

    var numAudioTracks = pc._transceivers.filter(function(t) {
      return t.kind === 'audio';
    }).length;
    var numVideoTracks = pc._transceivers.filter(function(t) {
      return t.kind === 'video';
    }).length;

    // Determine number of audio and video tracks we need to send/recv.
    var offerOptions = arguments[0];
    if (offerOptions) {
      // Reject Chrome legacy constraints.
      if (offerOptions.mandatory || offerOptions.optional) {
        throw new TypeError(
          'Legacy mandatory/optional constraints not supported.');
      }
      if (offerOptions.offerToReceiveAudio !== undefined) {
        if (offerOptions.offerToReceiveAudio === true) {
          numAudioTracks = 1;
        } else if (offerOptions.offerToReceiveAudio === false) {
          numAudioTracks = 0;
        } else {
          numAudioTracks = offerOptions.offerToReceiveAudio;
        }
      }
      if (offerOptions.offerToReceiveVideo !== undefined) {
        if (offerOptions.offerToReceiveVideo === true) {
          numVideoTracks = 1;
        } else if (offerOptions.offerToReceiveVideo === false) {
          numVideoTracks = 0;
        } else {
          numVideoTracks = offerOptions.offerToReceiveVideo;
        }
      }
    }

    pc._transceivers.forEach(function(transceiver) {
      if (transceiver.kind === 'audio') {
        numAudioTracks--;
        if (numAudioTracks < 0) {
          transceiver.wantReceive = false;
        }
      } else if (transceiver.kind === 'video') {
        numVideoTracks--;
        if (numVideoTracks < 0) {
          transceiver.wantReceive = false;
        }
      }
    });

    // Create M-lines for recvonly streams.
    while (numAudioTracks > 0 || numVideoTracks > 0) {
      if (numAudioTracks > 0) {
        pc._createTransceiver('audio');
        numAudioTracks--;
      }
      if (numVideoTracks > 0) {
        pc._createTransceiver('video');
        numVideoTracks--;
      }
    }

    var sdp = SDPUtils.writeSessionBoilerplate(pc._sdpSessionId,
      pc._sdpSessionVersion++);
    pc._transceivers.forEach(function(transceiver) {
      // For each track, create an ice gatherer, ice transport,
      // dtls transport, potentially rtpsender and rtpreceiver.
      var track = transceiver.track;
      var kind = transceiver.kind;
      var mid = transceiver.mid || SDPUtils.generateIdentifier();
      transceiver.mid = mid;
      if (transceiver.sdpMLineIndex === undefined) {
        transceiver.sdpMLineIndex = pc._transceivers.reduce(function(max, t) {
          return t.sdpMLineIndex !== undefined &&
            t.sdpMLineIndex >= max ? t.sdpMLineIndex + 1 : max;
        }, 0);
      }

      if (!transceiver.iceGatherer) {
        transceiver.iceGatherer = pc._createIceGatherer(transceiver,
          pc._usingBundle);
      }

      if (transceiver.rejected) {
        return;
      }

      var localCapabilities = window.RTCRtpSender.getCapabilities(kind);
      // filter RTX until additional stuff needed for RTX is implemented
      // in adapter.js
      if (edgeVersion < 15019) {
        localCapabilities.codecs = localCapabilities.codecs.filter(
          function(codec) {
            return codec.name !== 'rtx';
          });
      }
      localCapabilities.codecs.forEach(function(codec) {
        // work around https://bugs.chromium.org/p/webrtc/issues/detail?id=6552
        // by adding level-asymmetry-allowed=1
        if (codec.name.toLowerCase() === 'h264' &&
            codec.parameters['level-asymmetry-allowed'] === undefined) {
          codec.parameters['level-asymmetry-allowed'] = '1';
        }

        // for subsequent offers, we might have to re-use the payload
        // type of the last offer.
        if (transceiver.remoteCapabilities &&
            transceiver.remoteCapabilities.codecs) {
          transceiver.remoteCapabilities.codecs.forEach(function(remoteCodec) {
            if (codec.name.toLowerCase() === remoteCodec.name.toLowerCase() &&
                codec.clockRate === remoteCodec.clockRate) {
              codec.preferredPayloadType = remoteCodec.payloadType;
            }
          });
        }
      });
      localCapabilities.headerExtensions.forEach(function(hdrExt) {
        var remoteExtensions = transceiver.remoteCapabilities &&
            transceiver.remoteCapabilities.headerExtensions || [];
        remoteExtensions.forEach(function(rHdrExt) {
          if (hdrExt.uri === rHdrExt.uri) {
            hdrExt.id = rHdrExt.id;
          }
        });
      });

      // generate an ssrc now, to be used later in rtpSender.send
      var sendEncodingParameters = transceiver.sendEncodingParameters || [{
        ssrc: (2 * transceiver.sdpMLineIndex + 1) * 1001
      }];
      if (track) {
        // add RTX
        if (edgeVersion >= 15019 && kind === 'video' &&
            !sendEncodingParameters[0].rtx) {
          sendEncodingParameters[0].rtx = {
            ssrc: sendEncodingParameters[0].ssrc + 1
          };
        }
      }

      if (transceiver.wantReceive) {
        transceiver.rtpReceiver = new window.RTCRtpReceiver(
          transceiver.dtlsTransport, kind);
      }

      transceiver.localCapabilities = localCapabilities;
      transceiver.sendEncodingParameters = sendEncodingParameters;
    });

    // always offer BUNDLE and dispose on return if not supported.
    if (pc._config.bundlePolicy !== 'max-compat') {
      sdp += 'a=group:BUNDLE ' + pc._transceivers.map(function(t) {
        return t.mid;
      }).join(' ') + '\r\n';
    }
    sdp += 'a=ice-options:trickle\r\n';

    var mediaSections = [];
    pc._transceivers.forEach(function(transceiver) {
      var mediaSection = '';
      if (transceiver.rejected) {
        mediaSection = writeRejectedMediaSection(transceiver);
      } else {
        mediaSection = writeMediaSection(transceiver,
          transceiver.localCapabilities, 'offer', transceiver.stream,
          pc._dtlsRole);
        mediaSection += 'a=rtcp-rsize\r\n';

        if (transceiver.iceGatherer && pc._iceGatheringState !== 'new' &&
            (transceiver.sdpMLineIndex === 0 || !pc._usingBundle)) {
          transceiver.iceGatherer.getLocalCandidates().forEach(function(cand) {
            cand.component = 1;
            mediaSection += 'a=' + SDPUtils.writeCandidate(cand) + '\r\n';
          });

          if (transceiver.iceGatherer.state === 'complete') {
            mediaSection += 'a=end-of-candidates\r\n';
          }
        }
      }
      mediaSections[transceiver.sdpMLineIndex] = mediaSection;
    });
    sdp += mediaSections.join('');

    var desc = new window.RTCSessionDescription({
      type: 'offer',
      sdp: sdp
    });
    return Promise.resolve(desc);
  };

  RTCPeerConnection.prototype.createAnswer = function() {
    var pc = this;

    if (pc._isClosed) {
      return Promise.reject(util.makeError('InvalidStateError',
        'Can not call createAnswer after close'));
    }

    if (!(pc._signalingState === 'have-remote-offer' ||
        pc._signalingState === 'have-local-pranswer')) {
      return Promise.reject(util.makeError('InvalidStateError',
        'Can not call createAnswer in signalingState ' + pc._signalingState));
    }

    var sdp = SDPUtils.writeSessionBoilerplate(pc._sdpSessionId,
      pc._sdpSessionVersion++);
    if (pc._usingBundle) {
      sdp += 'a=group:BUNDLE ' + pc._transceivers.map(function(t) {
        return t.mid;
      }).join(' ') + '\r\n';
    }
    sdp += 'a=ice-options:trickle\r\n';

    var mediaSections = [];
    pc._transceivers.forEach(function(transceiver) {
      if (transceiver.sdpMLineIndex === undefined) {
        return;
      }
      var sdpMLineIndex = transceiver.sdpMLineIndex;
      var mediaSection = '';
      if (transceiver.rejected) {
        mediaSection = writeRejectedMediaSection(transceiver);
        mediaSections[sdpMLineIndex] = mediaSection;
        return;
      }

      // FIXME: look at direction.
      if (transceiver.stream) {
        var localTrack;
        if (transceiver.kind === 'audio') {
          localTrack = transceiver.stream.getAudioTracks()[0];
        } else if (transceiver.kind === 'video') {
          localTrack = transceiver.stream.getVideoTracks()[0];
        }
        if (localTrack) {
          // add RTX
          if (edgeVersion >= 15019 && transceiver.kind === 'video' &&
              !transceiver.sendEncodingParameters[0].rtx) {
            transceiver.sendEncodingParameters[0].rtx = {
              ssrc: transceiver.sendEncodingParameters[0].ssrc + 1
            };
          }
        }
      }

      // Calculate intersection of capabilities.
      var commonCapabilities = getCommonCapabilities(
        transceiver.localCapabilities,
        transceiver.remoteCapabilities);

      var hasRtx = commonCapabilities.codecs.filter(function(c) {
        return c.name.toLowerCase() === 'rtx';
      }).length;
      if (!hasRtx && transceiver.sendEncodingParameters[0].rtx) {
        delete transceiver.sendEncodingParameters[0].rtx;
      }

      mediaSection += writeMediaSection(transceiver, commonCapabilities,
        'answer', transceiver.stream, pc._dtlsRole);
      if (transceiver.rtcpParameters &&
          transceiver.rtcpParameters.reducedSize) {
        mediaSection += 'a=rtcp-rsize\r\n';
      }
      mediaSections[sdpMLineIndex] = mediaSection;
    });
    sdp += mediaSections.join('');

    var desc = new window.RTCSessionDescription({
      type: 'answer',
      sdp: sdp
    });
    return Promise.resolve(desc);
  };

  RTCPeerConnection.prototype.addIceCandidate = function(candidate) {
    var pc = this;
    var sections;
    if (candidate && !(candidate.sdpMLineIndex !== undefined ||
        candidate.sdpMid)) {
      return Promise.reject(new TypeError('sdpMLineIndex or sdpMid required'));
    }

    // TODO: needs to go into ops queue.
    return new Promise(function(resolve, reject) {
      if (!pc._remoteDescription) {
        return reject(util.makeError('InvalidStateError',
          'Can not add ICE candidate without a remote description'));
      } else if (!candidate || candidate.candidate === '') {
        for (var j = 0; j < pc._transceivers.length; j++) {
          if (pc._transceivers[j].rejected) {
            continue;
          }
          pc._transceivers[j].iceTransport.addRemoteCandidate({});
          sections = SDPUtils.getMediaSections(pc._remoteDescription.sdp);
          sections[pc._transceivers[j].sdpMLineIndex] +=
              'a=end-of-candidates\r\n';
          pc._remoteDescription.sdp =
              SDPUtils.getDescription(pc._remoteDescription.sdp) +
              sections.join('');
          if (pc._usingBundle) {
            break;
          }
        }
      } else {
        var sdpMLineIndex = candidate.sdpMLineIndex;
        if (candidate.sdpMid) {
          for (var i = 0; i < pc._transceivers.length; i++) {
            if (pc._transceivers[i].mid === candidate.sdpMid) {
              sdpMLineIndex = pc._transceivers[i].sdpMLineIndex;
              break;
            }
          }
        }
        var transceiver = pc._transceivers.find(function(t) {
          return t.sdpMLineIndex === sdpMLineIndex;
        });
        if (transceiver) {
          if (transceiver.rejected) {
            return resolve();
          }
          var cand = Object.keys(candidate.candidate).length > 0 ?
            SDPUtils.parseCandidate(candidate.candidate) : {};
          // Ignore Chrome's invalid candidates since Edge does not like them.
          if (cand.protocol === 'tcp' && (cand.port === 0 || cand.port === 9)) {
            return resolve();
          }
          // Ignore RTCP candidates, we assume RTCP-MUX.
          if (cand.component && cand.component !== 1) {
            return resolve();
          }
          // when using bundle, avoid adding candidates to the wrong
          // ice transport. And avoid adding candidates added in the SDP.
          if (sdpMLineIndex === 0 || (sdpMLineIndex > 0 &&
              transceiver.iceTransport !== pc._transceivers[0].iceTransport)) {
            if (!util.maybeAddCandidate(transceiver.iceTransport, cand)) {
              return reject(util.makeError('OperationError',
                'Can not add ICE candidate'));
            }
          }

          // update the remoteDescription.
          var candidateString = candidate.candidate.trim();
          if (candidateString.indexOf('a=') === 0) {
            candidateString = candidateString.substr(2);
          }
          sections = SDPUtils.getMediaSections(pc._remoteDescription.sdp);
          sections[transceiver.sdpMLineIndex] += 'a=' +
              (cand.type ? candidateString : 'end-of-candidates')
              + '\r\n';
          pc._remoteDescription.sdp =
              SDPUtils.getDescription(pc._remoteDescription.sdp) +
              sections.join('');
        } else {
          return reject(util.makeError('OperationError',
            'Can not add ICE candidate'));
        }
      }
      resolve();
    });
  };

  RTCPeerConnection.prototype.getStats = function(selector) {
    if (selector && selector instanceof window.MediaStreamTrack) {
      var senderOrReceiver = null;
      this._transceivers.forEach(function(transceiver) {
        if (transceiver.rtpSender &&
            transceiver.rtpSender.track === selector) {
          senderOrReceiver = transceiver.rtpSender;
        } else if (transceiver.rtpReceiver &&
            transceiver.rtpReceiver.track === selector) {
          senderOrReceiver = transceiver.rtpReceiver;
        }
      });
      if (!senderOrReceiver) {
        throw util.makeError('InvalidAccessError', 'Invalid selector.');
      }
      return senderOrReceiver.getStats();
    }

    var promises = [];
    this._transceivers.forEach(function(transceiver) {
      ['rtpSender', 'rtpReceiver', 'iceGatherer', 'iceTransport',
        'dtlsTransport'].forEach(function(method) {
        if (transceiver[method]) {
          promises.push(transceiver[method].getStats());
        }
      });
    });
    return Promise.all(promises).then(function(allStats) {
      var results = new Map();
      allStats.forEach(function(stats) {
        stats.forEach(function(stat) {
          results.set(stat.id, stat);
        });
      });
      return results;
    });
  };

  // legacy callback shims. Should be moved to adapter.js some day?
  util.shimLegacyCallbacks(RTCPeerConnection);

  return RTCPeerConnection;
};
