/*
 *  Copyright (c) 2017 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
const chai = require('chai');
const expect = chai.expect;
const sinon = require('sinon');
chai.use(require('dirty-chai'));
chai.use(require('sinon-chai'));

const mockORTC = require('./ortcmock');
const mockGetUserMedia = require('./gummock');
const shimPeerConnection = require('../rtcpeerconnection');
const SDPUtils = require('sdp');

const FINGERPRINT_SHA256 = '00:00:00:00:00:00:00:00:00:00:00:00:00' +
    ':00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00';
const ICEUFRAG = 'someufrag';
const ICEPWD = 'somelongpwdwithenoughrandomness';
const SDP_BOILERPLATE = 'v=0\r\n' +
    'o=- 166855176514521964 2 IN IP4 127.0.0.1\r\n' +
    's=-\r\n' +
    't=0 0\r\n' +
    'a=msid-semantic:WMS *\r\n';
const MINIMAL_AUDIO_MLINE =
    'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' +
    'c=IN IP4 0.0.0.0\r\n' +
    'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
    'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
    'a=ice-pwd:' + ICEPWD + '\r\n' +
    'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
    'a=setup:actpass\r\n' +
    'a=mid:audio1\r\n' +
    'a=sendonly\r\n' +
    'a=rtcp-mux\r\n' +
    'a=rtcp-rsize\r\n' +
    'a=rtpmap:111 opus/48000/2\r\n' +
    'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level\r\n' +
    'a=ssrc:1001 cname:some\r\n';

// this detects that we are not running in a browser.
const mockWindow = typeof window === 'undefined';

describe('Edge shim', () => {
  let RTCPeerConnection;
  beforeEach(() => {
    if (mockWindow) {
      global.window = {setTimeout};
      mockGetUserMedia(window);
      mockORTC(window);
      global.navigator = window.navigator;
    }
    RTCPeerConnection = shimPeerConnection(window, 15025);
  });

  beforeEach(() => {
    let streams = [];
    let release = () => {
      streams.forEach((stream) => {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
      });
      streams = [];
    };

    let origGetUserMedia = navigator.getUserMedia.bind(navigator);
    navigator.getUserMedia = (constraints, cb, eb) => {
      origGetUserMedia(constraints, (stream) => {
        streams.push(stream);
        if (cb) {
          cb.apply(null, [stream]);
        }
      }, eb);
    };
    navigator.getUserMedia.restore = () => {
      navigator.getUserMedia = origGetUserMedia;
      release();
    };

    let origMediaDevicesGetUserMedia =
        navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => {
      return origMediaDevicesGetUserMedia(constraints, (stream) => {
        streams.push(stream);
        return stream;
      });
    };
    navigator.mediaDevices.getUserMedia.restore = () => {
      navigator.mediaDevices.getUserMedia = origMediaDevicesGetUserMedia;
      release();
    };
  });

  afterEach(() => {
    navigator.getUserMedia.restore();
    navigator.mediaDevices.getUserMedia.restore();
  });

  describe('RTCPeerConnection constructor', () => {
    it('throws a NotSupportedError when called with ' +
        'rtcpMuxPolicy negotiate', () => {
      const constructor = () => {
        return new RTCPeerConnection({rtcpMuxPolicy: 'negotiate'});
      };
      expect(constructor).to.throw(/rtcpMuxPolicy/)
        .that.has.property('name').that.equals('NotSupportedError');
    });

    describe('when RTCIceCandidatePoolSize is set', () => {
      beforeEach(() => {
        sinon.spy(window, 'RTCIceGatherer');
      });

      afterEach(() => {
        window.RTCIceGatherer.restore();
      });

      it('creates an ICE Gatherer', () => {
        new RTCPeerConnection({iceCandidatePoolSize: 1});
        expect(window.RTCIceGatherer).to.have.been.calledOnce();
      });

      // TODO: those tests are convenient because they are sync and
      //    dont require createOffer-SLD before creating the gatherer.
      it('sets default ICETransportPolicy on RTCIceGatherer', () => {
        new RTCPeerConnection({iceCandidatePoolSize: 1});
        expect(window.RTCIceGatherer).to.have.been.calledWith(sinon.match({
          gatherPolicy: 'all'
        }));
      });

      it('sets ICETransportPolicy=all on RTCIceGatherer', () => {
        new RTCPeerConnection({iceCandidatePoolSize: 1,
          iceTransportPolicy: 'all'});
        expect(window.RTCIceGatherer).to.have.been.calledWith(sinon.match({
          gatherPolicy: 'all'
        }));
      });
      it('sets ICETransportPolicy=relay on RTCIceGatherer', () => {
        new RTCPeerConnection({iceCandidatePoolSize: 1,
          iceTransportPolicy: 'relay'});
        expect(window.RTCIceGatherer).to.have.been.calledWith(sinon.match({
          gatherPolicy: 'relay'
        }));
      });
    });
  });

  describe('prototype', () => {
    ['icecandidate', 'addstream', 'removestream', 'track',
      'signalingstatechange', 'iceconnectionstatechange',
      'icegatheringstatechange', 'negotiationneeded'].forEach((name) => {
      it('has on' + name + ' handler', () => {
        expect(RTCPeerConnection.prototype)
          .to.have.ownPropertyDescriptor('on' + name);
      });
    });
  });

  describe('close', () => {
    let pc;
    beforeEach(() => {
      pc = new RTCPeerConnection();
    });
    it('sets the signalingState to closed', () => {
      pc.close();
      expect(pc.signalingState).to.equal('closed');
    });

    it('does not fire signalingstatechange', () => {
      pc.onsignalingstatechange = sinon.stub();
      pc.close();
      expect(pc.onsignalingstatechange).not.to.have.been.calledWith();
    });

    it('sets the iceConnectionState to closed', () => {
      pc.close();
      expect(pc.iceConnectionState).to.equal('closed');
    });

    it('sets the connectionState to closed', () => {
      pc.close();
      expect(pc.connectionState).to.equal('closed');
    });
  });

  describe('setLocalDescription', () => {
    let pc;
    beforeEach(() => {
      pc = new RTCPeerConnection();
    });
    afterEach(() => {
      if (pc.signalingState !== 'closed') {
        pc.close();
      }
    });

    it('returns a promise', (done) => {
      pc.createOffer({offerToReceiveAudio: true})
        .then((offer) => pc.setLocalDescription(offer))
        .then(done);
    });

    it('calls the legacy success callback', (done) => {
      pc.createOffer({offerToReceiveAudio: true})
        .then((offer) => {
          return pc.setLocalDescription(offer, done, () => {});
        });
    });

    it('throws an InvalidStateError when called after close', (done) => {
      pc.createOffer({offerToReceiveAudio: true})
        .then((offer) => {
          pc.close();
          return pc.setLocalDescription(offer);
        })
        .catch((e) => {
          expect(e.name).to.equal('InvalidStateError');
          done();
        });
    });
    it('throws an InvalidStateError when called after close ' +
        '(callback)', (done) => {
      pc.createOffer({offerToReceiveAudio: true})
        .then((offer) => {
          pc.close();
          return pc.setLocalDescription(offer, undefined, (e) => {
            expect(e.name).to.equal('InvalidStateError');
            done();
          });
        });
    });

    it('throws a TypeError when called with an ' +
        'unsupported description type', (done) => {
      pc.setLocalDescription({type: 'invalid'})
        .catch((e) => {
          expect(e.name).to.equal('TypeError');
          done();
        });
    });


    it('changes the signalingState to have-local-offer', () => {
      return pc.createOffer({offerToReceiveAudio: true})
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          expect(pc.localDescription.type).to.equal('offer');
          expect(pc.signalingState = 'have-local-offer');
        });
    });

    it('calls the signalingstatechange event', () => {
      pc.onsignalingstatechange = sinon.stub();
      return pc.createOffer({offerToReceiveAudio: true})
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          expect(pc.onsignalingstatechange).to.have.been.calledOnce();
        });
    });

    describe('InvalidStateError is thrown when called with', () => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
      it('an offer in signalingState have-remote-offer', (done) => {
        pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => pc.setLocalDescription({type: 'offer'}))
          .catch((e) => {
            expect(e.name).to.equal('InvalidStateError');
            done();
          });
      });

      it('an answer in signalingState have-local-offer', (done) => {
        pc.createOffer({offerToReceiveAudio: true})
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => pc.setLocalDescription({type: 'answer'}))
          .catch((e) => {
            expect(e.name).to.equal('InvalidStateError');
            done();
          });
      });
    });

    describe('starts emitting ICE candidates', () => {
      let clock;
      beforeEach(() => {
        clock = sinon.useFakeTimers();
      });
      afterEach(() => {
        clock.restore();
      });

      describe('calls', () => {
        it('the onicecandidate callback', (done) => {
          pc.onicegatheringstatechange = () => {
            if (pc.iceGatheringState === 'complete') {
              expect(pc.onicecandidate).to.have.been.calledWith();
              done();
            }
          };
          pc.onicecandidate = sinon.stub();
          pc.createOffer({offerToReceiveAudio: true})
            .then(offer => pc.setLocalDescription(offer))
            .then(() => {
              window.setTimeout(() => {
                clock.tick(500);
              });
              clock.tick(0);
            });
        });
        it('the icecandidate event listener', (done) => {
          const stub = sinon.stub();
          pc.onicegatheringstatechange = () => {
            if (pc.iceGatheringState === 'complete') {
              expect(stub).to.have.been.calledWith();
              done();
            }
          };
          pc.addEventListener('icecandidate', stub);
          pc.createOffer({offerToReceiveAudio: true})
            .then(offer => pc.setLocalDescription(offer))
            .then(() => {
              window.setTimeout(() => {
                clock.tick(500);
              });
              clock.tick(0);
            });
        });
      });

      it('updates localDescription.sdp with candidates', (done) => {
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') {
            expect(SDPUtils.matchPrefix(pc.localDescription.sdp,
              'a=candidate:').length).to.be.above(0);
            expect(SDPUtils.matchPrefix(pc.localDescription.sdp,
              'a=end-of-candidates')).to.have.length(1);
            done();
          }
        };
        pc.createOffer({offerToReceiveAudio: true})
          .then(offer => pc.setLocalDescription(offer))
          .then(() => {
            window.setTimeout(() => {
              clock.tick(500);
            });
            clock.tick(0);
          });
      });

      it('changes iceGatheringState and emits icegatheringstatechange ' +
          'event', (done) => {
        let states = [];
        pc.addEventListener('icegatheringstatechange', () => {
          states.push(pc.iceGatheringState);
          if (pc.iceGatheringState === 'complete') {
            expect(states.length).to.equal(2);
            expect(states).to.contain('gathering');
            expect(states).to.contain('complete');
            done();
          }
        });
        pc.createOffer({offerToReceiveAudio: true})
          .then(offer => pc.setLocalDescription(offer))
          .then(() => {
            expect(pc.iceGatheringState).to.equal('new');
            clock.tick(500);
          });
      });

      it('does not serialize extra parameters in ' +
          'RTCICECandidate.toJSON', (done) => {
        const candidates = [];
        pc.onicecandidate = (e) => {
          candidates.push(e.candidate);
        };
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') {
            const reserialized = JSON.parse(JSON.stringify(candidates[0]));
            expect(reserialized.candidate).to.be.a('string');
            expect(reserialized.usernameFragment).to.be.a('string');
            expect(reserialized.sdpMid).to.be.a('string');
            expect(reserialized.sdpMLineIndex).to.equal(0);
            expect(Object.keys(reserialized)).to.have.length(4);
            done();
          }
        };
        pc.createOffer({offerToReceiveAudio: true})
          .then(offer => pc.setLocalDescription(offer))
          .then(() => {
            window.setTimeout(() => {
              clock.tick(500);
            });
            clock.tick(0);
          });
      });
    });

    describe('after setRemoteDescription', () => {
      beforeEach(() => {
        sinon.spy(window.RTCIceTransport.prototype, 'start');
        sinon.spy(window.RTCDtlsTransport.prototype, 'start');
        sinon.spy(window.RTCRtpSender.prototype, 'setTransport');
      });
      afterEach(() => {
        window.RTCIceTransport.prototype.start.restore();
        window.RTCDtlsTransport.prototype.start.restore();
        window.RTCRtpSender.prototype.setTransport.restore();
      });

      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
      it('starts the ice transport', () => {
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => pc.createAnswer())
          .then((answer) => pc.setLocalDescription(answer))
          .then(() => {
            const receiver = pc.getReceivers()[0];
            const iceTransport = receiver.transport.transport;
            expect(iceTransport.start).to.have.been.calledOnce();
            expect(iceTransport.start).to.have.been.calledWith(
              sinon.match.any,
              sinon.match({
                usernameFragment: '' + ICEUFRAG + '',
                password: '' + ICEPWD + ''
              })
            );
          });
      });

      it('starts the dtls transport', () => {
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => pc.createAnswer())
          .then((answer) => pc.setLocalDescription(answer))
          .then(() => {
            const receiver = pc.getReceivers()[0];
            const dtlsTransport = receiver.transport;
            expect(dtlsTransport.start).to.have.been.calledOnce();
            expect(dtlsTransport.start).to.have.been.calledWith(
              sinon.match({
                role: 'auto',
                fingerprints: sinon.match([
                  sinon.match({
                    algorithm: 'sha-256',
                    value: FINGERPRINT_SHA256
                  })
                ])
              })
            );
          });
      });

      it('sets the RTPSender transport', () => {
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => navigator.mediaDevices.getUserMedia({audio: true}))
          .then((stream) => {
            pc.addTrack(stream.getAudioTracks()[0], stream);
            return pc.createAnswer();
          })
          .then((answer) => pc.setLocalDescription(answer))
          .then(() => {
            const sender = pc.getSenders()[0];
            expect(sender.setTransport).to.have.been.calledOnce();
            expect(sender.transport).not.to.equal(null);
          });
      });
    });
  });

  describe('setRemoteDescription', () => {
    let pc;
    beforeEach(() => {
      pc = new RTCPeerConnection();
    });
    afterEach(() => {
      if (pc.signalingState !== 'closed') {
        pc.close();
      }
    });

    it('returns a promise', (done) => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
      pc.setRemoteDescription({type: 'offer', sdp})
        .then(done);
    });
    it('calls the legacy success callback', (done) => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
      pc.setRemoteDescription({type: 'offer', sdp}, done, () => {});
    });

    it('changes the signalingState to have-remote-offer', (done) => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
      pc.setRemoteDescription({type: 'offer', sdp})
        .then(() => {
          expect(pc.signalingState = 'have-remote-offer');
          done();
        });
    });

    it('calls the signalingstatechange event', () => {
      pc.onsignalingstatechange = sinon.stub();
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
      pc.setRemoteDescription({type: 'offer', sdp})
        .then(() => {
          expect(pc.onsignalingstatechange).to.have.been.calledOnce();
        });
    });

    it('throws an InvalidStateError when called after close', (done) => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
      pc.close();
      pc.setRemoteDescription({type: 'offer', sdp})
        .catch((e) => {
          expect(e.name).to.equal('InvalidStateError');
          done();
        });
    });

    it('throws an InvalidStateError when called after close ' +
        '(callback)', (done) => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
      pc.close();
      pc.setRemoteDescription({type: 'offer', sdp}, undefined, (e) => {
        expect(e.name).to.equal('InvalidStateError');
        done();
      });
    });

    it('throws a TypeError when called with an ' +
        'unsupported description type', (done) => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
      pc.setRemoteDescription({type: 'invalid', sdp})
        .catch((e) => {
          expect(e.name).to.equal('TypeError');
          done();
        });
    });

    it('sets the remoteDescription', () => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
      return pc.setRemoteDescription({type: 'offer', sdp})
        .then(() => {
          expect(pc.remoteDescription.type).to.equal('offer');
          expect(pc.remoteDescription.sdp).to.equal(sdp);
        });
    });

    describe('when called with an offer containing a track', () => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE +
          'a=ssrc:1001 msid:stream1 track1\r\n';
      it('triggers onaddstream', (done) => {
        pc.onaddstream = (event) => {
          const stream = event.stream;
          expect(stream.getTracks().length).to.equal(1);
          expect(stream.getTracks()[0].kind).to.equal('audio');

          done();
        };
        pc.setRemoteDescription({type: 'offer', sdp});
      });

      it('emits a addstream event', (done) => {
        pc.addEventListener('addstream', (event) => {
          const stream = event.stream;
          expect(stream.getTracks().length).to.equal(1);
          expect(stream.getTracks()[0].kind).to.equal('audio');

          done();
        });
        pc.setRemoteDescription({type: 'offer', sdp});
      });

      it('triggers ontrack', (done) => {
        pc.ontrack = (event) => {
          expect(event.track.kind).to.equal('audio');
          expect(event.receiver);
          expect(event.streams.length).to.equal(1);

          done();
        };
        pc.setRemoteDescription({type: 'offer', sdp});
      });

      it('emits a track event', (done) => {
        pc.addEventListener('track', (event) => {
          expect(event.track.kind).to.equal('audio');
          expect(event.receiver);
          expect(event.streams.length).to.equal(1);

          done();
        });
        pc.setRemoteDescription({type: 'offer', sdp});
      });

      it('triggers ontrack and track event before resolving', (done) => {
        var trackEvent = sinon.stub();
        pc.addEventListener('track', trackEvent);
        pc.ontrack = sinon.stub();
        pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => {
            expect(trackEvent).to.have.been.calledWith();
            expect(pc.ontrack).to.have.been.calledWith();
            done();
          });
      });

      describe('without a stream (stream id -)', () => {
        it('does not trigger onaddstream', (done) => {
          let clock = sinon.useFakeTimers();
          pc.onaddstream = sinon.stub();
          pc.setRemoteDescription({type: 'offer',
            sdp: sdp.replace('stream1', '-')})
            .then(() => {
              window.setTimeout(() => {
                expect(pc.onaddstream).not.to.have.been.calledWith();
                clock.restore();
                done();
              }, 0);
              clock.tick(500);
            });
        });

        it('does trigger ontrack with an empty streams set', (done) => {
          pc.addEventListener('track', (event) => {
            expect(event.track.kind).to.equal('audio');
            expect(event.receiver);
            expect(event.streams.length).to.equal(0);

            done();
          });
          pc.setRemoteDescription({type: 'offer',
            sdp: sdp.replace('stream1', '-')});
        });
      });
    });

    describe('when called with an offer without (explicit) tracks', () => {
      const sdp = (SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE)
        .replace('a=msid-semantics:WMS *\r\n', '');

      it('triggers onaddstream', (done) => {
        pc.onaddstream = (event) => {
          const stream = event.stream;
          expect(stream.getTracks().length).to.equal(1);
          expect(stream.getTracks()[0].kind).to.equal('audio');

          done();
        };
        pc.setRemoteDescription({type: 'offer', sdp});
      });

      it('triggers ontrack', (done) => {
        pc.ontrack = (event) => {
          expect(event.track.kind).to.equal('audio');
          expect(event).to.have.property('receiver');
          expect(event).to.have.property('transceiver');
          expect(event.streams).to.have.lengthOf(1);
          done();
        };
        pc.setRemoteDescription({type: 'offer', sdp});
      });
    });

    describe('when called with an offer containing multiple streams ' +
        '/ tracks', () => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE +
          'a=ssrc:1001 msid:stream1 track1\r\n' +
          'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' +
          'c=IN IP4 0.0.0.0\r\n' +
          'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
          'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
          'a=ice-pwd:' + ICEPWD + '\r\n' +
          'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
          'a=setup:actpass\r\n' +
          'a=mid:audio2\r\n' +
          'a=sendonly\r\n' +
          'a=rtcp-mux\r\n' +
          'a=rtcp-rsize\r\n' +
          'a=rtpmap:111 opus/48000/2\r\n' +
          'a=ssrc:2002 msid:stream2 track2\r\n' +
          'a=ssrc:2002 cname:some\r\n';

      it('triggers onaddstream twice', (done) => {
        let numStreams = 0;
        pc.onaddstream = (event) => {
          numStreams++;
          expect(event.stream.id).to.equal('stream' + numStreams);
          if (numStreams === 2) {
            done();
          }
        };
        pc.setRemoteDescription({type: 'offer', sdp});
      });

      it('triggers ontrack twice', (done) => {
        let numTracks = 0;
        pc.ontrack = (event) => {
          numTracks++;
          expect(event.streams[0].id).to.equal('stream' + numTracks);
          if (numTracks === 2) {
            done();
          }
        };
        pc.setRemoteDescription({type: 'offer', sdp});
      });
    });

    describe('when called with a bundle offer after adding ' +
        'two tracks', () => {
      const sdp = SDP_BOILERPLATE +
          'a=group:BUNDLE audio1 video1\r\n' +
          MINIMAL_AUDIO_MLINE +
          'a=ssrc:1001 msid:stream1 track1\r\n' +
          'm=video 1 UDP/TLS/RTP/SAVPF 100\r\n' +
          'c=IN IP4 0.0.0.0\r\n' +
          'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
          'a=ice-pwd:' + ICEPWD + '\r\n' +
          'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
          'a=setup:actpass\r\n' +
          'a=mid:video1\r\n' +
          'a=sendonly\r\n' +
          'a=rtcp-mux\r\n' +
          'a=rtcp-rsize\r\n' +
          'a=rtpmap:100 VP8/90000\r\n' +
          'a=rtcp:1 IN IP4 0.0.0.0\r\n' +
          'a=rtcp-fb:100 nack\r\n' +
          'a=rtcp-fb:100 nack pli\r\n' +
          'a=rtcp-fb:100 goog-remb\r\n' +
          'a=extmap:1 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time\r\n' +
          'a=ssrc:2002 msid:stream2 track2\r\n' +
          'a=ssrc:2002 cname:some\r\n';
      it('disposes the second ice transport', () => {
        return navigator.mediaDevices.getUserMedia({audio: true, video: true})
          .then((stream) => {
          // this creates two transceivers with ice transports.
            pc.addStream(stream);

            // this has bundle so will set usingBundle. But two
            // transceivers and their ice/dtls transports exist
            // and the second one needs to be disposed.
            return pc.setRemoteDescription({type: 'offer', sdp});
          })
          .then(() => pc.createAnswer())
          .then((answer) => pc.setLocalDescription(answer))
          .then(() => {
            const senders = pc.getSenders();
            // the second ice transport should have been disposed.
            expect(senders[0].transport.transport).to
              .equal(senders[1].transport.transport);
          });
      });
    });

    describe('when called with an offer without an a=ssrc line', () => {
      const sdp = SDP_BOILERPLATE +
          'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' +
          'c=IN IP4 0.0.0.0\r\n' +
          'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
          'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
          'a=ice-pwd:' + ICEPWD + '\r\n' +
          'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
          'a=setup:actpass\r\n' +
          'a=mid:audio2\r\n' +
          'a=sendonly\r\n' +
          'a=rtcp-mux\r\n' +
          'a=rtcp-rsize\r\n' +
          'a=rtpmap:111 opus/48000/2\r\n';
      beforeEach(() => {
        sinon.spy(window.RTCRtpReceiver.prototype, 'receive');
      });
      afterEach(() => {
        window.RTCRtpReceiver.prototype.receive.restore();
      });

      it('calls RTCRtpReceiver.recv with encodings set to [{}]', () => {
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => {
            const receiver = pc.getReceivers()[0];
            expect(receiver.receive).to.have.been.calledWith(
              sinon.match({encodings: [{}]})
            );
          });
      });
    });

    // TODO: add a test for recvonly to show it doesn't trigger the callback.
    //   probably easiest done using a sinon.stub
    //
    describe('sets the canTrickleIceCandidates property', () => {
      it('to true when called with an offer that contains ' +
          'a=ice-options:trickle', () => {
        const sdp = SDP_BOILERPLATE +
            'a=ice-options:trickle\r\n';
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => {
            expect(pc.canTrickleIceCandidates).to.equal(true);
          });
      });

      it('to false when called with an offer that does not contain ' +
          'a=ice-options:trickle', () => {
        const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
        pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => {
            expect(pc.canTrickleIceCandidates).to.equal(false);
          });
      });
    });

    describe('when called with an offer containing candidates', () => {
      beforeEach(() => {
        sinon.spy(window.RTCIceTransport.prototype, 'addRemoteCandidate');
        sinon.spy(window.RTCIceTransport.prototype, 'setRemoteCandidates');
      });
      afterEach(() => {
        window.RTCIceTransport.prototype.addRemoteCandidate.restore();
        window.RTCIceTransport.prototype.setRemoteCandidates.restore();
      });
      const candidate = 'a=candidate:702786350 1 udp 41819902 ' +
          '8.8.8.8 60769 typ host';
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE +
          'a=ssrc:1001 msid:stream1 track1\r\n' +
          candidate + '\r\n';
      it('adds the candidates to the ice transport', () => {
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => {
            const receiver = pc.getReceivers()[0];
            const iceTransport = receiver.transport.transport;
            expect(iceTransport.addRemoteCandidate).to.have.been.calledOnce();
          });
      });

      it('interprets end-of-candidates', () => {
        return pc.setRemoteDescription({type: 'offer',
          sdp: sdp + 'a=end-of-candidates\r\n'
        })
          .then(() => {
            const receiver = pc.getReceivers()[0];
            const iceTransport = receiver.transport.transport;
            expect(iceTransport.setRemoteCandidates).to.have.been.calledOnce();
          });
      });

      it('does not add the candidate in a subsequent offer ' +
          'again', () => {
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => { // call SRD again.
            return pc.setRemoteDescription({type: 'offer', sdp});
          })
          .then(() => {
            const receiver = pc.getReceivers()[0];
            const iceTransport = receiver.transport.transport;
            expect(iceTransport.addRemoteCandidate).to.have.been.calledOnce();
          });
      });

      it('does not add the candidates when they are also supplied ' +
          'with addIceCandidate', () => {
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => {
            const receiver = pc.getReceivers()[0];
            const iceTransport = receiver.transport.transport;

            pc.addIceCandidate({sdpMid: 'audio1', sdpMLineIndex: 0, candidate})
              .catch(() => {});
            expect(iceTransport.addRemoteCandidate).to.have.been.calledOnce();
          });
      });
    });

    describe('when called with an answer containing candidates', () => {
      let pc2;
      beforeEach(() => {
        pc2 = new RTCPeerConnection();
        sinon.spy(window.RTCIceTransport.prototype, 'addRemoteCandidate');
        sinon.spy(window.RTCIceTransport.prototype, 'setRemoteCandidates');
        return navigator.mediaDevices.getUserMedia({audio: true})
          .then(stream => pc.addStream(stream))
          .then(() => pc.createOffer())
          .then((offer) => {
            return Promise.all([
              pc.setLocalDescription(offer),
              pc2.setRemoteDescription(offer)
            ]);
          });
      });
      afterEach(() => {
        if (pc2.signalingState !== 'closed') {
          pc2.close();
        }
        window.RTCIceTransport.prototype.addRemoteCandidate.restore();
        window.RTCIceTransport.prototype.setRemoteCandidates.restore();
      });

      const candidate = 'a=candidate:702786350 1 udp 41819902 ' +
          '8.8.8.8 60769 typ host';

      it('adds the candidates to the ice transport', () => {
        return pc2.createAnswer()
          .then((answer) => {
            answer.sdp += candidate + '\r\n';
            return pc.setRemoteDescription(answer);
          })
          .then(() => {
            const sender = pc.getSenders()[0];
            const iceTransport = sender.transport.transport;
            expect(iceTransport.addRemoteCandidate).to.have.been.calledOnce();
          });
      });

      it('interprets end-of-candidates', () => {
        return pc2.createAnswer()
          .then((answer) => {
            answer.sdp += candidate + '\r\n';
            answer.sdp += 'a=end-of-candidates\r\n';
            return pc.setRemoteDescription(answer);
          })
          .then(() => {
            const sender = pc.getSenders()[0];
            const iceTransport = sender.transport.transport;
            expect(iceTransport.setRemoteCandidates).to.have.been.calledOnce();
          });
      });
    });

    describe('InvalidStateError is thrown when called with', () => {
      it('an answer in signalingState stable', () => {
        return pc.setRemoteDescription({type: 'answer'})
          .catch((e) => {
            expect(e.name).to.equal('InvalidStateError');
          });
      });

      it('an offer in signalingState have-local-offer', () => {
        return pc.createOffer({offerToReceiveAudio: true})
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => pc.setRemoteDescription({type: 'offer'}))
          .catch((e) => {
            expect(e.name).to.equal('InvalidStateError');
          });
      });
    });

    describe('when called with an subsequent offer', () => {
      let clock;
      beforeEach(() => {
        clock = sinon.useFakeTimers();
      });
      afterEach(() => {
        clock.restore();
      });

      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE +
          'a=ssrc:1001 msid:stream1 audiotrack\r\n';
      const videoPart =
          'm=video 9 UDP/TLS/RTP/SAVPF 102 103\r\n' +
          'c=IN IP4 0.0.0.0\r\n' +
          'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
          'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
          'a=ice-pwd:' + ICEPWD + '\r\n' +
          'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
          'a=setup:actpass\r\n' +
          'a=mid:video1\r\n' +
          'a=sendrecv\r\n' +
          'a=rtcp-mux\r\n' +
          'a=rtcp-rsize\r\n' +
          'a=rtpmap:102 vp8/90000\r\n' +
          'a=rtpmap:103 rtx/90000\r\n' +
          'a=fmtp:103 apt=102\r\n' +
          'a=ssrc-group:FID 1001 1002\r\n' +
          'a=ssrc:1001 msid:stream1 videotrack\r\n' +
          'a=ssrc:1001 cname:some\r\n' +
          'a=ssrc:1002 msid:stream1 videotrack\r\n' +
          'a=ssrc:1002 cname:some\r\n';

      describe('adding a new track', () => {
        it('triggers ontrack', (done) => {
          pc.onaddstream = sinon.stub();
          pc.ontrack = sinon.stub();
          pc.setRemoteDescription({type: 'offer', sdp})
            .then(() => {
              return pc.setRemoteDescription({type: 'offer',
                sdp: sdp + videoPart});
            })
            .then(() => {
              window.setTimeout(() => {
                expect(pc.onaddstream).to.have.been.calledOnce();
                expect(pc.ontrack).to.have.been.calledTwice();
                done();
              });
              clock.tick(500);
            });
        });

        it('fires the stream addtrack event', (done) => {
          let remoteStream;
          pc.onaddstream = (e) => {
            remoteStream = e.stream;
            remoteStream.addEventListener('addtrack', (event) => {
              expect(event).to.be.an.instanceOf(window.MediaStreamTrackEvent);
              expect(event).to.have.property('track');
              expect(event.track.id).to.equal('videotrack');
              done();
            });
          };
          pc.setRemoteDescription({type: 'offer', sdp})
            .then(() => {
              window.setTimeout(() => {
                pc.setRemoteDescription({type: 'offer', sdp: sdp + videoPart});
              });
              clock.tick(500);
            });
        });
      });

      describe('removing a track', () => {
        it('fires the stream removetrack event', (done) => {
          let remoteStream;
          pc.onaddstream = (e) => {
            remoteStream = e.stream;
            remoteStream.addEventListener('removetrack', (event) => {
              expect(event).to.be.an.instanceOf(window.MediaStreamTrackEvent);
              expect(event).to.have.property('track');
              expect(event.track.id).to.equal('videotrack');
              done();
            });
          };
          pc.setRemoteDescription({type: 'offer', sdp: sdp + videoPart})
            .then(() => {
              window.setTimeout(() => {
                pc.setRemoteDescription({type: 'offer', sdp:
                  sdp + videoPart.replace('sendrecv', 'recvonly')});
              });
              clock.tick(500);
            });
        });
      });

      describe('going from rejected to non-rejected', () => {
        it('triggers ontrack', (done) => {
          pc.onaddstream = sinon.stub();
          pc.ontrack = sinon.stub();
          pc.setRemoteDescription({type: 'offer',
            sdp: sdp.replace('m=audio 9', 'm=audio 0')})
            .then(() => {
              return pc.setRemoteDescription({type: 'offer',
                sdp});
            })
            .then(() => {
              window.setTimeout(() => {
                expect(pc.onaddstream).to.have.been.calledOnce();
                expect(pc.ontrack).to.have.been.calledOnce();
                done();
              });
              clock.tick(500);
            });
        });
      });
    });

    describe('when rtcp-rsize is', () => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE +
          'a=ssrc:1001 msid:stream1 track1\r\n';
      beforeEach(() => {
        sinon.spy(window.RTCRtpReceiver.prototype, 'receive');
      });
      afterEach(() => {
        window.RTCRtpReceiver.prototype.receive.restore();
      });

      it('set RtpReceiver is called with compound set to false', () => {
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => {
            const receiver = pc.getReceivers()[0];
            expect(receiver.receive).to.have.been.calledWith(
              sinon.match({rtcp: sinon.match({compound: false})})
            );
          });
      });
      it('not set RtpReceiver is called with compound set to true', () => {
        return pc.setRemoteDescription({type: 'offer',
          sdp: sdp.replace('a=rtcp-rsize\r\n', '')})
          .then(() => {
            const receiver = pc.getReceivers()[0];
            expect(receiver.receive).to.have.been.calledWith(
              sinon.match({rtcp: sinon.match({compound: true})})
            );
          });
      });
    });

    describe('with an ice-lite offer', () => {
      beforeEach(() => {
        sinon.spy(window.RTCDtlsTransport.prototype, 'start');
        sinon.spy(window.RTCIceTransport.prototype, 'start');
      });
      afterEach(() => {
        window.RTCDtlsTransport.prototype.start.restore();
        window.RTCIceTransport.prototype.start.restore();
      });

      const sdp = SDP_BOILERPLATE +
          'a=ice-lite\r\n' +
          MINIMAL_AUDIO_MLINE;

      it('set the ice role to controlling', () => {
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => pc.createAnswer())
          .then((answer) => pc.setLocalDescription(answer))
          .then(() => {
            const receiver = pc.getReceivers()[0];
            const dtlsTransport = receiver.transport;
            const iceTransport = dtlsTransport.transport;
            expect(iceTransport.start).to.have.been.calledOnce();
            expect(iceTransport.start).to.have.been.calledWith(
              sinon.match.any,
              sinon.match.any,
              sinon.match('controlling')
            );
          });
      });

      it('sets the dtls role to server', () => {
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => pc.createAnswer())
          .then((answer) => pc.setLocalDescription(answer))
          .then(() => {
            const receiver = pc.getReceivers()[0];
            const dtlsTransport = receiver.transport;
            expect(dtlsTransport.start).to.have.been.calledOnce();
            expect(dtlsTransport.start).to.have.been.calledWith(
              sinon.match({
                role: 'server'
              })
            );
          });
      });
    });

    describe('with an answer', () => {
      beforeEach(() => {
        sinon.spy(window.RTCIceTransport.prototype, 'setRemoteCandidates');
      });
      afterEach(() => {
        window.RTCIceTransport.prototype.setRemoteCandidates.restore();
      });

      it('ignores extra candidates in a bundle answer', () => {
        return pc.createOffer({offerToReceiveAudio: true,
          offerToReceiveVideo: true})
          .then(offer => pc.setLocalDescription(offer))
          .then(() => {
            const mids = SDPUtils.getMediaSections(pc.localDescription.sdp)
              .map(mediaSection => SDPUtils.getMid(mediaSection));
            const sdp = SDP_BOILERPLATE +
                'a=group:BUNDLE ' + mids.join(' ') + '\r\n' +
                MINIMAL_AUDIO_MLINE.replace('audio1', mids[0]) +
                'a=candidate:702786350 1 udp 41819902 8.8.8.8 60769 ' +
                  'typ host\r\n' +
                'a=end-of-candidates\r\n' +
                'm=video 9 UDP/TLS/RTP/SAVPF 102\r\n' +
                'c=IN IP4 0.0.0.0\r\n' +
                'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
                'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
                'a=ice-pwd:' + ICEPWD + '\r\n' +
                'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
                'a=setup:actpass\r\n' +
                'a=mid:' + mids[1] + '\r\n' +
                'a=sendrecv\r\n' +
                'a=rtcp-mux\r\n' +
                'a=rtcp-rsize\r\n' +
                'a=rtpmap:102 vp8/90000\r\n' +
                'a=ssrc:1002 cname:some\r\n' +
                'a=candidate:702786350 1 udp 41819902 8.8.8.8 60769 ' +
                  'typ host\r\n' +
                'a=end-of-candidates\r\n';
            return pc.setRemoteDescription({type: 'answer', sdp});
          })
          .then(() => {
            const receiver = pc.getReceivers()[0];
            const iceTransport = receiver.transport.transport;
            expect(iceTransport.setRemoteCandidates).to.have.been.calledOnce();
          });
      });
    });

    it('treats bundle-only m-lines as not rejected', () => {
      const sdp = SDP_BOILERPLATE +
          'a=group:BUNDLE audio1 video1\r\n' +
          MINIMAL_AUDIO_MLINE +
          'a=candidate:702786350 1 udp 41819902 8.8.8.8 60769 typ host\r\n' +
          'a=msid:stream1 audiotrack\r\n' +
          'a=end-of-candidates\r\n' +
          'm=video 0 UDP/TLS/RTP/SAVPF 102\r\n' +
          'c=IN IP4 0.0.0.0\r\n' +
          'a=bundle-only\r\n' +
          'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
          'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
          'a=ice-pwd:' + ICEPWD + '\r\n' +
          'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
          'a=setup:actpass\r\n' +
          'a=mid:video1\r\n' +
          'a=sendrecv\r\n' +
          'a=rtcp-mux\r\n' +
          'a=rtcp-rsize\r\n' +
          'a=rtpmap:102 vp8/90000\r\n' +
          'a=ssrc:1002 cname:some\r\n' +
          'a=candidate:702786350 1 udp 41819902 8.8.8.8 60769 typ host\r\n' +
          'a=msid:stream1 videotrack\r\n' +
          'a=end-of-candidates\r\n';
      return pc.setRemoteDescription({type: 'offer', sdp})
        .then(() => {
          const receivers = pc.getReceivers();
          expect(receivers).to.have.length(2);
          expect(receivers[1].track.id).to.equal('videotrack');
        });
    });

    describe('simulates end-of-candidates from remote', () => {
      let clock;
      before(() => {
        clock = sinon.useFakeTimers();
      });
      after(() => {
        clock.restore();
      });

      it('with a timeout', () => {
        const sdp = SDP_BOILERPLATE +
            MINIMAL_AUDIO_MLINE +
            'a=candidate:702786350 1 udp 41819902 8.8.8.8 60769 typ host\r\n';
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => {
            const receiver = pc.getReceivers()[0];
            const dtlsTransport = receiver.transport;
            const iceTransport = dtlsTransport.transport;
            const spy = sinon.spy(iceTransport, 'addRemoteCandidate');
            clock.tick(10000);
            expect(spy).to.have.been.calledWith({});
          });
      });

      it('does nothing when the peerconnection is already closed', () => {
        const sdp = SDP_BOILERPLATE +
            MINIMAL_AUDIO_MLINE +
            'a=candidate:702786350 1 udp 41819902 8.8.8.8 60769 typ host\r\n';
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => {
            pc.close();
            clock.tick(10000);
          });
      });
    });

    it('does not call signalingstatechange again when ' +
       'already in current state', () => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
      pc.onsignalingstatechange = sinon.stub();
      return pc.setRemoteDescription({type: 'offer', sdp})
        .then(() => pc.setRemoteDescription({type: 'offer', sdp}))
        .then(() => {
          expect(pc.onsignalingstatechange).to.have.been.calledOnce();
        });
    });

    it('throws InvalidAccessError when the peerconnection is created ' +
       'with rtcpMuxPolicy=require and there is no rtcp-mux', () => {
      // muxpolicy=require is impliit in Edge.
      const sdp = SDP_BOILERPLATE +
          MINIMAL_AUDIO_MLINE.replace('a=rtcp-mux\r\n', '');
      return pc.setRemoteDescription({type: 'offer', sdp})
        .catch(e => {
          expect(e.name).to.equal('InvalidAccessError');
        });
    });

    it('rejects invalid SDP with an InvalidAccessError', () => {
      return pc.setRemoteDescription({type: 'offer', sdp: 'invalid'})
        .catch(e => {
          expect(e.name).to.equal('InvalidAccessError');
        });
    });
  });

  describe('createOffer', () => {
    let pc;
    beforeEach(() => {
      pc = new RTCPeerConnection();
    });
    afterEach(() => {
      if (pc.signalingState !== 'closed') {
        pc.close();
      }
    });

    it('returns a promise', (done) => {
      pc.createOffer({offerToReceiveAudio: true})
        .then(() => {
          done();
        });
    });

    it('calls the legacy success callback', (done) => {
      pc.createOffer((offer) => {
        expect(offer.type).to.equal('offer');
        done();
      }, () => {}, {offerToReceiveAudio: true});
    });

    it('calls the legacy success callback and resolves with ' +
       'no arguments', (done) => {
      pc.createOffer((offer) => {})
        .then((shouldBeUndefined) => {
          expect(shouldBeUndefined).to.equal(undefined);
          done();
        });
    });

    it('does not change the signalingState', () => {
      return pc.createOffer({offerToReceiveAudio: true})
        .then(() => {
          expect(pc.signalingState).to.equal('stable');
        });
    });

    it('uses pooled RTCIceGatherer', () => {
      pc.close();
      pc = new RTCPeerConnection({iceCandidatePoolSize: 1});
      return pc.createOffer({offerToReceiveAudio: true})
        .then(() => {
          expect(pc._iceGatherers).to.have.length(0);
        });
    });

    it('does not start emitting ICE candidates', () => {
      let clock = sinon.useFakeTimers();
      pc.onicecandidate = sinon.stub();
      return pc.createOffer({offerToReceiveAudio: true})
        .then(() => {
          clock.tick(500);
          expect(pc.onicecandidate).not.to.have.been.calledWith();
          clock.restore();
        });
    });

    it('throws an InvalidStateError when called after close', () => {
      pc.close();
      return pc.createOffer({offerToReceiveAudio: true})
        .catch((e) => {
          expect(e.name).to.equal('InvalidStateError');
        });
    });

    it('throws an InvalidStateError when called after close ' +
        '(callback)', (done) => {
      pc.close();
      pc.createOffer(undefined, (e) => {
        expect(e.name).to.equal('InvalidStateError');
        done();
      }, {offerToReceiveAudio: true});
    });

    describe('throws a TypeError when called with legacy constraints', () => {
      it('(optional)', () => {
        expect(() => pc.createOffer({optional: {OfferToReceiveAudio: true}}))
          .to.throw()
          .that.has.property('name').that.equals('TypeError');
      });

      it('(mandatory)', () => {
        expect(() => pc.createOffer({mandatory: {OfferToReceiveAudio: true}}))
          .to.throw()
          .that.has.property('name').that.equals('TypeError');
      });
    });

    describe('when called with offerToReceiveAudio', () => {
      it('= true the generated SDP should contain one audio m-line', () => {
        return pc.createOffer({offerToReceiveAudio: true})
          .then((offer) => {
            const sections = SDPUtils.getMediaSections(offer.sdp);
            expect(sections.length).to.equal(1);
            expect(SDPUtils.getDirection(sections[0])).to.equal('recvonly');
          });
      });

      // probably legacy which was covered by the spec at some point.
      it('= 2 the generated SDP should contain two audio m-lines', () => {
        return pc.createOffer({offerToReceiveAudio: 2})
          .then((offer) => {
            const sections = SDPUtils.getMediaSections(offer.sdp);
            expect(sections.length).to.equal(2);
            expect(SDPUtils.getDirection(sections[0])).to.equal('recvonly');
            expect(SDPUtils.getDirection(sections[1])).to.equal('recvonly');
          });
      });

      it('= true the generated SDP should contain one audio m-line', () => {
        return pc.createOffer({offerToReceiveAudio: true})
          .then((offer) => {
            const sections = SDPUtils.getMediaSections(offer.sdp);
            expect(sections.length).to.equal(1);
            expect(SDPUtils.getDirection(sections[0])).to.equal('recvonly');
          });
      });

      it('= false the generated SDP should not offer to receive audio', () => {
        return navigator.mediaDevices.getUserMedia({audio: true})
          .then((stream) => {
            pc.addStream(stream);
            return pc.createOffer({offerToReceiveAudio: false});
          })
          .then((offer) => {
            const sections = SDPUtils.getMediaSections(offer.sdp);
            expect(sections.length).to.equal(1);
            expect(SDPUtils.getDirection(sections[0])).to.equal('sendonly');
          });
      });

      it('= false and no local track the generated SDP should not ' +
          'contain a m-line', () => {
        // see https://github.com/rtcweb-wg/jsep/issues/832
        return pc.createOffer({offerToReceiveAudio: false})
          .then((offer) => {
            const sections = SDPUtils.getMediaSections(offer.sdp);
            expect(sections).to.have.length(0);
          });
      });
    });

    describe('when called with offerToReceiveVideo', () => {
      it('= true the generated SDP should contain one video m-line', () => {
        return pc.createOffer({offerToReceiveVideo: true})
          .then((offer) => {
            const sections = SDPUtils.getMediaSections(offer.sdp);
            expect(sections.length).to.equal(1);
            expect(SDPUtils.getDirection(sections[0])).to.equal('recvonly');
          });
      });

      // probably legacy which was covered by the spec at some point.
      it('= 2 the generated SDP should contain two video m-lines', () => {
        return pc.createOffer({offerToReceiveVideo: 2})
          .then((offer) => {
            const sections = SDPUtils.getMediaSections(offer.sdp);
            expect(sections.length).to.equal(2);
            expect(SDPUtils.getDirection(sections[0])).to.equal('recvonly');
            expect(SDPUtils.getDirection(sections[1])).to.equal('recvonly');
          });
      });

      it('= true the generated SDP should contain one video m-line', () => {
        return pc.createOffer({offerToReceiveVideo: true})
          .then((offer) => {
            const sections = SDPUtils.getMediaSections(offer.sdp);
            expect(sections.length).to.equal(1);
            expect(SDPUtils.getDirection(sections[0])).to.equal('recvonly');
          });
      });

      it('= false the generated SDP should not offer to receive video', () => {
        return navigator.mediaDevices.getUserMedia({video: true})
          .then((stream) => {
            pc.addStream(stream);
            return pc.createOffer({offerToReceiveVideo: false});
          })
          .then((offer) => {
            const sections = SDPUtils.getMediaSections(offer.sdp);
            expect(sections.length).to.equal(1);
            expect(SDPUtils.getDirection(sections[0])).to.equal('sendonly');
          });
      });

      it('= false and no local track the generated SDP should not ' +
          'contain a m-line', () => {
        // see https://github.com/rtcweb-wg/jsep/issues/832
        return pc.createOffer({offerToReceiveVideo: false})
          .then((offer) => {
            const sections = SDPUtils.getMediaSections(offer.sdp);
            expect(sections).to.have.length(0);
          });
      });
    });

    describe('when called with offerToReceiveAudio and ' +
        'offerToReceiveVideo', () => {
      it('the generated SDP should contain two m-lines', () => {
        return pc.createOffer({offerToReceiveAudio: true,
          offerToReceiveVideo: true})
          .then((offer) => {
            const sections = SDPUtils.getMediaSections(offer.sdp);
            expect(sections.length).to.equal(2);
            expect(SDPUtils.getDirection(sections[0])).to.equal('recvonly');
            expect(SDPUtils.getKind(sections[0])).to.equal('audio');
            expect(SDPUtils.getDirection(sections[1])).to.equal('recvonly');
            expect(SDPUtils.getKind(sections[1])).to.equal('video');
          });
      });
    });

    describe('when called after adding a stream', () => {
      describe('with an audio track', () => {
        it('the generated SDP should contain an audio m-line', () => {
          return navigator.mediaDevices.getUserMedia({audio: true})
            .then((stream) => {
              pc.addStream(stream);
              return pc.createOffer();
            })
            .then((offer) => {
              const sections = SDPUtils.getMediaSections(offer.sdp);
              expect(sections.length).to.equal(1);
              expect(SDPUtils.getDirection(sections[0])).to.equal('sendrecv');
            });
        });
      });

      describe('with an audio track not offering to receive audio', () => {
        it('the generated SDP should contain a sendonly audio m-line', () => {
          return navigator.mediaDevices.getUserMedia({audio: true})
            .then((stream) => {
              pc.addStream(stream);
              return pc.createOffer({offerToReceiveAudio: false});
            })
            .then((offer) => {
              const sections = SDPUtils.getMediaSections(offer.sdp);
              expect(sections.length).to.equal(1);
              expect(SDPUtils.getDirection(sections[0])).to.equal('sendonly');
            });
        });
      });

      describe('with an audio track and offering to receive video', () => {
        it('the generated SDP should contain a recvonly m-line', () => {
          return navigator.mediaDevices.getUserMedia({audio: true})
            .then((stream) => {
              pc.addStream(stream);
              return pc.createOffer({offerToReceiveVideo: true});
            })
            .then((offer) => {
              const sections = SDPUtils.getMediaSections(offer.sdp);
              expect(sections.length).to.equal(2);
              expect(SDPUtils.getKind(sections[0])).to.equal('audio');
              expect(SDPUtils.getDirection(sections[0])).to.equal('sendrecv');
              expect(SDPUtils.getKind(sections[1])).to.equal('video');
              expect(SDPUtils.getDirection(sections[1])).to.equal('recvonly');
            });
        });
      });

      describe('with a video track', () => {
        it('the generated SDP should contain an video m-line', () => {
          return navigator.mediaDevices.getUserMedia({video: true})
            .then((stream) => {
              pc.addStream(stream);
              return pc.createOffer();
            })
            .then((offer) => {
              const sections = SDPUtils.getMediaSections(offer.sdp);
              expect(sections.length).to.equal(1);
              expect(SDPUtils.getKind(sections[0])).to.equal('video');
            });
        });
      });

      describe('with a video track and offerToReceiveAudio', () => {
        it('the generated SDP should contain a video and an ' +
            'audio m-line', () => {
          return navigator.mediaDevices.getUserMedia({video: true})
            .then((stream) => {
              pc.addStream(stream);
              return pc.createOffer({offerToReceiveAudio: true});
            })
            .then((offer) => {
              const sections = SDPUtils.getMediaSections(offer.sdp);
              expect(sections.length).to.equal(2);
              expect(SDPUtils.getKind(sections[0])).to.equal('video');
              expect(SDPUtils.getKind(sections[1])).to.equal('audio');
            });
        });
      });


      describe('with an audio track and a video track', () => {
        it('the generated SDP should contain an audio and video ' +
            'm-line', () => {
          return navigator.mediaDevices.getUserMedia({audio: true, video: true})
            .then((stream) => {
              pc.addStream(stream);
              return pc.createOffer();
            })
            .then((offer) => {
              const sections = SDPUtils.getMediaSections(offer.sdp);
              expect(sections.length).to.equal(2);
              expect(SDPUtils.getKind(sections[0])).to.equal('audio');
              expect(SDPUtils.getKind(sections[1])).to.equal('video');
            });
        });
      });

      describe('with an audio track and two video tracks', () => {
        it('the generated SDP should contain an audio and ' +
            'video m-line', () => {
          return navigator.mediaDevices.getUserMedia({audio: true, video: true})
            .then((stream) => {
              pc.addStream(stream);
              return navigator.mediaDevices.getUserMedia({video: true});
            })
            .then((stream) => {
              pc.addStream(stream);
              return pc.createOffer();
            })
            .then((offer) => {
              const sections = SDPUtils.getMediaSections(offer.sdp);
              expect(sections.length).to.equal(3);
              expect(SDPUtils.getKind(sections[0])).to.equal('audio');
              expect(SDPUtils.getKind(sections[1])).to.equal('video');
              expect(SDPUtils.getKind(sections[2])).to.equal('video');
            });
        });
      });
    });

    describe('when called after addTrack', () => {
      describe('with an audio track', () => {
        it('the generated SDP should contain a sendrecv audio m-line', () => {
          return navigator.mediaDevices.getUserMedia({audio: true})
            .then((stream) => {
              pc.addTrack(stream.getAudioTracks()[0], stream);
              return pc.createOffer();
            })
            .then((offer) => {
              const sections = SDPUtils.getMediaSections(offer.sdp);
              expect(sections.length).to.equal(1);
              expect(SDPUtils.getDirection(sections[0])).to.equal('sendrecv');
            });
        });
      });

      describe('with an audio track not offering to receive audio', () => {
        it('the generated SDP should contain a sendonly audio ' +
            'm-line', () => {
          return navigator.mediaDevices.getUserMedia({audio: true})
            .then((stream) => {
              pc.addTrack(stream.getAudioTracks()[0], stream);
              return pc.createOffer({offerToReceiveAudio: false});
            })
            .then((offer) => {
              const sections = SDPUtils.getMediaSections(offer.sdp);
              expect(sections.length).to.equal(1);
              expect(SDPUtils.getDirection(sections[0])).to.equal('sendonly');
            });
        });
      });

      describe('with an audio track and offering to receive video', () => {
        it('the generated SDP should contain a sendrecv audio m-line ' +
           'and a recvonly video m-line', () => {
          return navigator.mediaDevices.getUserMedia({audio: true})
            .then((stream) => {
              pc.addTrack(stream.getAudioTracks()[0], stream);
              return pc.createOffer({offerToReceiveVideo: true});
            })
            .then((offer) => {
              const sections = SDPUtils.getMediaSections(offer.sdp);
              expect(sections.length).to.equal(2);
              expect(SDPUtils.getKind(sections[0])).to.equal('audio');
              expect(SDPUtils.getDirection(sections[0])).to.equal('sendrecv');
              expect(SDPUtils.getKind(sections[1])).to.equal('video');
              expect(SDPUtils.getDirection(sections[1])).to.equal('recvonly');
            });
        });
      });

      describe('with a video track', () => {
        it('the generated SDP should contain an video m-line', () => {
          return navigator.mediaDevices.getUserMedia({video: true})
            .then((stream) => {
              pc.addTrack(stream.getVideoTracks()[0], stream);
              return pc.createOffer();
            })
            .then((offer) => {
              const sections = SDPUtils.getMediaSections(offer.sdp);
              expect(sections.length).to.equal(1);
              expect(SDPUtils.getKind(sections[0])).to.equal('video');
            });
        });
      });

      describe('with a video track and offerToReceiveAudio', () => {
        it('the generated SDP should contain a video and an ' +
            'audio m-line', () => {
          return navigator.mediaDevices.getUserMedia({video: true})
            .then((stream) => {
              pc.addTrack(stream.getVideoTracks()[0], stream);
              return pc.createOffer({offerToReceiveAudio: true});
            })
            .then((offer) => {
              const sections = SDPUtils.getMediaSections(offer.sdp);
              expect(sections.length).to.equal(2);
              expect(SDPUtils.getKind(sections[0])).to.equal('video');
              expect(SDPUtils.getKind(sections[1])).to.equal('audio');
            });
        });
      });


      describe('with an audio track and a video track', () => {
        it('the generated SDP should contain an audio and video ' +
            'm-line', () => {
          return navigator.mediaDevices.getUserMedia({audio: true, video: true})
            .then((stream) => {
              stream.getTracks().forEach((track) => {
                pc.addTrack(track, stream);
              });
              return pc.createOffer();
            })
            .then((offer) => {
              const sections = SDPUtils.getMediaSections(offer.sdp);
              expect(sections.length).to.equal(2);
              expect(SDPUtils.getKind(sections[0])).to.equal('audio');
              expect(SDPUtils.getKind(sections[1])).to.equal('video');
            });
        });
      });

      describe('with an audio track and two video tracks', () => {
        it('the generated SDP should contain an audio and ' +
            'two video m-lines', () => {
          return navigator.mediaDevices.getUserMedia({audio: true, video: true})
            .then((stream) => {
              stream.getTracks().forEach((track) => {
                pc.addTrack(track, stream);
              });
              return navigator.mediaDevices.getUserMedia({video: true});
            })
            .then((stream) => {
              stream.getTracks().forEach((track) => {
                pc.addTrack(track, stream);
              });
              return pc.createOffer();
            })
            .then((offer) => {
              const sections = SDPUtils.getMediaSections(offer.sdp);
              expect(sections.length).to.equal(3);
              expect(SDPUtils.getKind(sections[0])).to.equal('audio');
              expect(SDPUtils.getKind(sections[1])).to.equal('video');
              expect(SDPUtils.getKind(sections[2])).to.equal('video');
            });
        });
      });

      describe('with an audio track but no stream', () => {
        it('creates an offer with msid stream set to "-"', () => {
          return navigator.mediaDevices.getUserMedia({audio: true})
            .then((stream) => {
              stream.getTracks().forEach((track) => {
                pc.addTrack(track);
              });
              return pc.createOffer();
            })
            .then((offer) => {
              const sections = SDPUtils.getMediaSections(offer.sdp);
              expect(sections.length).to.equal(1);
              const msid = SDPUtils.parseMsid(sections[0]);
              expect(msid.stream).to.equal('-');
            });
        });
      });
    });

    describe('when called subsequently', () => {
      let clock;
      beforeEach(() => {
        clock = sinon.useFakeTimers();
      });
      afterEach(() => {
        clock.restore();
      });

      it('contains the candidates already emitted', (done) => {
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState !== 'complete') {
            return;
          }
          pc.createOffer()
            .then((offer) => {
              const sections = SDPUtils.getMediaSections(offer.sdp);
              const candidates = SDPUtils.matchPrefix(sections[0],
                'a=candidate:');
              const end = SDPUtils.matchPrefix(sections[0],
                'a=end-of-candidates');
              expect(candidates.length).to.be.above(0);
              expect(end.length).to.equal(1);
              done();
            });
        };
        pc.createOffer({offerToReceiveAudio: true})
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            window.setTimeout(() => {
              clock.tick(500);
            });
            clock.tick(0);
          });
      });

      it('retains the session id', () => {
        let sessionId;
        return pc.createOffer({offerToReceiveAudio: true})
          .then((offer) => {
            sessionId = SDPUtils.matchPrefix(offer.sdp, 'o=')[0].split(' ')[1];
            return pc.createOffer({offerToReceiveAudio: true});
          })
          .then((offer) => {
            let sid = SDPUtils.matchPrefix(offer.sdp, 'o=')[0].split(' ')[1];
            expect(sid).to.equal(sessionId);
          });
      });

      it('increments the session version', () => {
        let version;
        return pc.createOffer({offerToReceiveAudio: true})
          .then((offer) => {
            version = SDPUtils.matchPrefix(offer.sdp, 'o=')[0]
              .split(' ')[2] >>> 0;
            return pc.createOffer({offerToReceiveAudio: true});
          })
          .then((offer) => {
            let ver = SDPUtils.matchPrefix(offer.sdp, 'o=')[0]
              .split(' ')[2] >>> 0;
            expect(ver).to.equal(version + 1);
          });
      });
    });

    describe('when called after SRD+createAnswer reversing the roles', () => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;

      it('retains the MID attribute', () => {
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => pc.createAnswer())
          .then((answer) => pc.setLocalDescription(answer))
          .then(() => pc.createOffer())
          .then((offer) => {
            const sections = SDPUtils.getMediaSections(offer.sdp);
            expect(SDPUtils.getMid(sections[0])).to.equal('audio1');
          });
      });

      it('retains the offerer payload types', () => {
        return pc.setRemoteDescription({type: 'offer',
          sdp: sdp.replace(/111/g, 98)
        })
          .then(() => pc.createAnswer())
          .then((answer) => pc.setLocalDescription(answer))
          .then(() => pc.createOffer())
          .then((offer) => {
            expect(offer.sdp).to.contain('a=rtpmap:98 opus');
            expect(offer.sdp).not.to.contain('a=rtpmap:111 opus');
          });
      });

      it('retains the offerer extmap ids', () => {
        const extmapUri = 'http://www.webrtc.org/experiments/' +
            'rtp-hdrext/abs-send-time';
        const videoSdp = SDP_BOILERPLATE +
          'm=video 9 UDP/TLS/RTP/SAVPF 102\r\n' +
          'c=IN IP4 0.0.0.0\r\n' +
          'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
          'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
          'a=ice-pwd:' + ICEPWD + '\r\n' +
          'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
          'a=setup:actpass\r\n' +
          'a=mid:video1\r\n' +
          'a=sendrecv\r\n' +
          'a=rtcp-mux\r\n' +
          'a=rtcp-rsize\r\n' +
          'a=rtpmap:102 vp8/90000\r\n' +
          'a=ssrc:1001 msid:stream1 track1\r\n' +
          'a=ssrc:1001 cname:some\r\n' +
          'a=extmap:5 ' + extmapUri + '\r\n';

        return pc.setRemoteDescription({type: 'offer', sdp: videoSdp})
          .then(() => pc.createAnswer())
          .then((answer) => pc.setLocalDescription(answer))
          .then(() => pc.createOffer())
          .then((offer) => {
            expect(offer.sdp).to.contain('a=extmap:5 ' + extmapUri + '\r\n');
          });
      });
    });

    describe('when called after rejecting a', () => {
      const legacy = SDP_BOILERPLATE +
        'm=application 9 DTLS/SCTP 5000\r\n' +
        'c=IN IP4 0.0.0.0\r\n' +
        'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
        'a=ice-pwd:' + ICEPWD + '\r\n' +
        'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
        'a=setup:actpass\r\n' +
        'a=mid:data\r\n' +
        'a=sctpmap:5000 webrtc-datachannel 1024\r\n';
      const newStyle = SDP_BOILERPLATE +
        'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n' +
        'c=IN IP4 0.0.0.0\r\n' +
        'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
        'a=ice-pwd:' + ICEPWD + '\r\n' +
        'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
        'a=setup:actpass\r\n' +
        'a=mid:data\r\n' +
        'a=sctp-port:5000\r\n' +
        'a=max-message-size:1073741823\r\n';
      new Map([['legacy', legacy],['new-style', newStyle]]).forEach(
        (sdp, style) => {
          it(`"${style}" datachannel offer`, () => {
            return navigator.mediaDevices.getUserMedia({audio: true})
              .then((stream) => {
                pc.addTrack(stream.getTracks()[0], stream);
                return pc.setRemoteDescription({type: 'offer', sdp: sdp});
              })
              .then(() => pc.createAnswer())
              .then((answer) => pc.setLocalDescription(answer))
              .then(() => pc.createOffer())
              .then((offer) => {
                const sections = SDPUtils.getMediaSections(offer.sdp);
                expect(sections).to.have.length(2);
                expect(SDPUtils.isRejected(sections[0])).to.equal(true);
                expect(SDPUtils.getKind(sections[1])).to.equal('audio');
              });
          });
        });
    });

    describe('after replaceTrack', () => {
      it('retains the original track id', () => {
        return navigator.mediaDevices.getUserMedia({audio: true})
          .then((stream) => {
            pc.addTrack(stream.getAudioTracks()[0], stream);
            return pc.createOffer();
          })
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => navigator.mediaDevices.getUserMedia({audio: true}))
          .then((stream) => {
            const sender = pc.getSenders()[0];
            return sender.replaceTrack(stream.getAudioTracks()[0]);
          })
          .then(() => pc.createOffer())
          .then((offer) => {
            const newMsid = SDPUtils.parseMsid(offer.sdp);
            const existingMsid = SDPUtils.parseMsid(pc.localDescription.sdp);
            expect(newMsid.track).to.equal(existingMsid.track);
          });
      });
    });
  });

  describe('createAnswer', () => {
    let pc;
    beforeEach(() => {
      pc = new RTCPeerConnection();
    });
    afterEach(() => {
      pc.close();
    });

    it('returns a promise', (done) => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
      pc.setRemoteDescription({type: 'offer', sdp})
        .then(() => pc.createAnswer())
        .then(() => {
          done();
        });
    });

    it('calls the legacy success callback', (done) => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
      pc.setRemoteDescription({type: 'offer', sdp})
        .then(() => {
          return pc.createAnswer((answer) => {
            expect(answer.type).to.equal('answer');
            done();
          }, () => {});
        });
    });

    it('calls the legacy success callback and resolves with ' +
       'no arguments', () => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
      return pc.setRemoteDescription({type: 'offer', sdp})
        .then(() => {
          return pc.createAnswer((answer) => {});
        })
        .then((shouldBeUndefined) => {
          expect(shouldBeUndefined).to.equal(undefined);
        });
    });

    it('does not change the signaling state', () => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
      return pc.setRemoteDescription({type: 'offer', sdp})
        .then(() => {
          expect(pc.signalingState).to.equal('have-remote-offer');
          return pc.createAnswer();
        })
        .then(() => {
          expect(pc.signalingState).to.equal('have-remote-offer');
        });
    });

    it('throws an InvalidStateError when called after close', () => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
      return pc.setRemoteDescription({type: 'offer', sdp})
        .then(() => {
          pc.close();
          return pc.createAnswer();
        })
        .catch((e) => {
          expect(e.name).to.equal('InvalidStateError');
        });
    });

    it('throws an InvalidStateError when called after close ' +
        '(callback)', (done) => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
      pc.setRemoteDescription({type: 'offer', sdp})
        .then(() => {
          pc.close();
          return pc.createAnswer(undefined, (e) => {
            expect(e.name).to.equal('InvalidStateError');
            done();
          });
        });
    });

    it('throws an InvalidStateError when called in the wrong ' +
        'signalingstate', () => {
      return pc.createAnswer()
        .catch((e) => {
          expect(e.name).to.equal('InvalidStateError');
        });
    });

    it('uses payload types of offerer', () => {
      const sdp = SDP_BOILERPLATE +
          'm=audio 9 UDP/TLS/RTP/SAVPF 98\r\n' +
          'c=IN IP4 0.0.0.0\r\n' +
          'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
          'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
          'a=ice-pwd:' + ICEPWD + '\r\n' +
          'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
          'a=setup:actpass\r\n' +
          'a=mid:audio1\r\n' +
          'a=sendrecv\r\n' +
          'a=rtcp-mux\r\n' +
          'a=rtcp-rsize\r\n' +
          'a=rtpmap:98 opus/48000/2\r\n' +
          'a=ssrc:1001 msid:stream1 track1\r\n' +
          'a=ssrc:1001 cname:some\r\n';
      return pc.setRemoteDescription({type: 'offer', sdp})
        .then(() => pc.createAnswer())
        .then((answer) => {
          expect(answer.sdp).to.contain('a=rtpmap:98 opus');
        });
    });

    it('uses the extmap ids of the offerer', () => {
      const extmapUri = 'http://www.webrtc.org/experiments/' +
          'rtp-hdrext/abs-send-time';
      const sdp = SDP_BOILERPLATE +
          MINIMAL_AUDIO_MLINE +
          'm=video 9 UDP/TLS/RTP/SAVPF 102\r\n' +
          'c=IN IP4 0.0.0.0\r\n' +
          'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
          'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
          'a=ice-pwd:' + ICEPWD + '\r\n' +
          'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
          'a=setup:actpass\r\n' +
          'a=mid:video1\r\n' +
          'a=sendrecv\r\n' +
          'a=rtcp-mux\r\n' +
          'a=rtcp-rsize\r\n' +
          'a=rtpmap:102 vp8/90000\r\n' +
          'a=ssrc:1001 msid:stream1 track1\r\n' +
          'a=ssrc:1001 cname:some\r\n' +
          'a=extmap:5 ' + extmapUri + '\r\n';
      return pc.setRemoteDescription({type: 'offer', sdp})
        .then(() => pc.createAnswer())
        .then((answer) => {
          expect(answer.sdp).to.contain('a=extmap:5 ' + extmapUri + '\r\n');
        });
    });

    it('returns the intersection of rtcp feedback', () => {
      const sdp = SDP_BOILERPLATE +
          'm=video 9 UDP/TLS/RTP/SAVPF 102\r\n' +
          'c=IN IP4 0.0.0.0\r\n' +
          'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
          'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
          'a=ice-pwd:' + ICEPWD + '\r\n' +
          'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
          'a=setup:actpass\r\n' +
          'a=mid:video1\r\n' +
          'a=sendrecv\r\n' +
          'a=rtcp-mux\r\n' +
          'a=rtcp-rsize\r\n' +
          'a=rtpmap:102 vp8/90000\r\n' +
          'a=rtcp-fb:102 nack\r\n' +
          'a=rtcp-fb:102 nack pli\r\n' +
          'a=rtcp-fb:102 goog-remb\r\n' +
          'a=ssrc:1001 msid:stream1 track1\r\n' +
          'a=ssrc:1001 cname:some\r\n';
      return pc.setRemoteDescription({type: 'offer', sdp})
        .then(() => pc.createAnswer())
        .then((answer) => {
          expect(answer.sdp).to.contain('a=rtcp-fb:102 nack\r\n');
          expect(answer.sdp).to.contain('a=rtcp-fb:102 nack pli\r\n');
          expect(answer.sdp).not.to.contain('a=rtcp-fb:102 goog-remb\r\n');
        });
    });

    it('rejects a m-line when there are no compatible codecs', () => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
      return pc.setRemoteDescription({type: 'offer',
        sdp: sdp.replace('opus', 'nosuchcodec')
      })
        .then(() => pc.createAnswer())
        .then((answer) => {
          const sections = SDPUtils.getMediaSections(answer.sdp);
          const rejected = SDPUtils.isRejected(sections[0]);
          expect(rejected).to.equal(true);
        });
    });

    describe('rejects a legacy datachannel offer', () => {
      const sdp = SDP_BOILERPLATE +
          'm=application 9 DTLS/SCTP 5000\r\n' +
          'c=IN IP4 0.0.0.0\r\n' +
          'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
          'a=ice-pwd:' + ICEPWD + '\r\n' +
          'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
          'a=setup:actpass\r\n' +
          'a=mid:data\r\n' +
          'a=sctpmap:5000 webrtc-datachannel 1024\r\n';
      it('in setRemoteDescription', () => {
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => pc.createAnswer())
          .then((answer) => {
            const sections = SDPUtils.getMediaSections(answer.sdp);
            const rejected = SDPUtils.isRejected(sections[0]);
            expect(rejected).to.equal(true);
          });
      });

      it('in setRemoteDescription with a local track', () => {
        // test that we don't forget about the track.
        return navigator.mediaDevices.getUserMedia({audio: true})
          .then((stream) => {
            pc.addTrack(stream.getTracks()[0], stream);
            return pc.setRemoteDescription({type: 'offer', sdp: sdp});
          })
          .then(() => {
            expect(pc.getSenders()).to.have.length(1);
          });
      });

      it('ignores candidates', () => {
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => {
            return pc.addIceCandidate({sdpMid: 'data', candidate:
              'candidate:702786350 1 udp 41819902 8.8.8.8 60769 typ host'});
          });
      });

      it('ignores end-of-candidates', () => {
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => pc.addIceCandidate());
      });
    });

    describe('rejects a new-style datachannel offer', () => {
      it('in setRemoteDescription', () => {
        const sdp = SDP_BOILERPLATE +
            'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n' +
            'c=IN IP4 0.0.0.0\r\n' +
            'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
            'a=ice-pwd:' + ICEPWD + '\r\n' +
            'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
            'a=setup:actpass\r\n' +
            'a=mid:data\r\n' +
            'a=sctp-port:5000\r\n' +
            'a=max-message-size:1073741823\r\n';
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => pc.createAnswer())
          .then((answer) => {
            const sections = SDPUtils.getMediaSections(answer.sdp);
            const rejected = SDPUtils.isRejected(sections[0]);
            expect(rejected).to.equal(true);
          });
      });
    });

    // test https://tools.ietf.org/html/draft-ietf-rtcweb-jsep-15#section-5.3.4
    describe('direction attribute', () => {
      const sdp = SDP_BOILERPLATE +
          'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' +
          'c=IN IP4 0.0.0.0\r\n' +
          'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
          'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
          'a=ice-pwd:' + ICEPWD + '\r\n' +
          'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
          'a=setup:actpass\r\n' +
          'a=mid:audio1\r\n' +
          'a=sendrecv\r\n' +
          'a=rtcp-mux\r\n' +
          'a=rtcp-rsize\r\n' +
          'a=rtpmap:111 opus/48000/2\r\n' +
          'a=ssrc:1001 msid:stream1 track1\r\n' +
          'a=ssrc:1001 cname:some\r\n';

      it('responds with a inactive answer to inactive', () => {
        return pc.setRemoteDescription({type: 'offer',
          sdp: sdp.replace('sendrecv', 'recvonly')
        })
          .then(() => pc.createAnswer())
          .then((answer) => {
            const sections = SDPUtils.getMediaSections(answer.sdp);
            expect(sections.length).to.equal(1);
            expect(SDPUtils.getDirection(sections[0])).to.equal('inactive');
          });
      });

      describe('with a local track', () => {
        it('responds with a sendrecv answer to sendrecv', () => {
          return navigator.mediaDevices.getUserMedia({audio: true})
            .then((stream) => {
              pc.addStream(stream);
              return pc.setRemoteDescription({type: 'offer', sdp});
            })
            .then(() => pc.createAnswer())
            .then((answer) => {
              const sections = SDPUtils.getMediaSections(answer.sdp);
              expect(SDPUtils.getDirection(sections[0])).to.equal('sendrecv');
            });
        });

        it('responds with a sendonly answer to recvonly', () => {
          return navigator.mediaDevices.getUserMedia({audio: true})
            .then((stream) => {
              pc.addStream(stream);
              return pc.setRemoteDescription({type: 'offer',
                sdp: sdp.replace('sendrecv', 'recvonly')
              });
            })
            .then(() => pc.createAnswer())
            .then((answer) => {
              const sections = SDPUtils.getMediaSections(answer.sdp);
              expect(sections.length).to.equal(1);
              expect(SDPUtils.getDirection(sections[0])).to.equal('sendonly');
            });
        });
      });

      describe('with a local track added after setRemoteDescription', () => {
        it('responds with a sendrecv answer to sendrecv', () => {
          return pc.setRemoteDescription({type: 'offer', sdp})
            .then(() => {
              return navigator.mediaDevices.getUserMedia({audio: true});
            })
            .then((stream) => {
              pc.addStream(stream);
              return pc.createAnswer();
            })
            .then((answer) => {
              const sections = SDPUtils.getMediaSections(answer.sdp);
              expect(SDPUtils.getDirection(sections[0])).to.equal('sendrecv');
            });
        });

        it('responds with a sendonly answer to recvonly', () => {
          return pc.setRemoteDescription({type: 'offer',
            sdp: sdp.replace('sendrecv', 'recvonly')
          })
            .then(() => navigator.mediaDevices.getUserMedia({audio: true}))
            .then((stream) => {
              pc.addStream(stream);
              return pc.createAnswer();
            })
            .then((answer) => {
              const sections = SDPUtils.getMediaSections(answer.sdp);
              expect(sections.length).to.equal(1);
              expect(SDPUtils.getDirection(sections[0])).to.equal('sendonly');
            });
        });
      });

      describe('with no local track', () => {
        it('responds with a recvonly answer to sendrecv', () => {
          return pc.setRemoteDescription({type: 'offer', sdp})
            .then(() => pc.createAnswer())
            .then((answer) => {
              const sections = SDPUtils.getMediaSections(answer.sdp);
              expect(SDPUtils.getDirection(sections[0])).to.equal('recvonly');
            });
        });

        it('responds with a inactive answer to recvonly', () => {
          return pc.setRemoteDescription({type: 'offer',
            sdp: sdp.replace('sendrecv', 'recvonly')
          })
            .then(() => pc.createAnswer())
            .then((answer) => {
              const sections = SDPUtils.getMediaSections(answer.sdp);
              expect(SDPUtils.getDirection(sections[0])).to.equal('inactive');
            });
        });
      });
    });

    describe('after a video offer with RTX', () => {
      const sdp = SDP_BOILERPLATE +
          'm=video 9 UDP/TLS/RTP/SAVPF 102 103\r\n' +
          'c=IN IP4 0.0.0.0\r\n' +
          'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
          'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
          'a=ice-pwd:' + ICEPWD + '\r\n' +
          'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
          'a=setup:actpass\r\n' +
          'a=mid:video1\r\n' +
          'a=sendrecv\r\n' +
          'a=rtcp-mux\r\n' +
          'a=rtcp-rsize\r\n' +
          'a=rtpmap:102 vp8/90000\r\n' +
          'a=rtpmap:103 rtx/90000\r\n' +
          'a=fmtp:103 apt=102\r\n';
      const remoteRTX = 'a=ssrc-group:FID 1001 1002\r\n' +
          'a=ssrc:1001 msid:stream1 track1\r\n' +
          'a=ssrc:1001 cname:some\r\n' +
          'a=ssrc:1002 msid:stream1 track1\r\n' +
          'a=ssrc:1002 cname:some\r\n';
      describe('with no local track', () => {
        it('creates an answer with RTX but no FID group', () => {
          return pc.setRemoteDescription({type: 'offer', sdp: sdp + remoteRTX})
            .then(() => pc.createAnswer())
            .then((answer) => {
              expect(answer.sdp).to.contain('a=rtpmap:102 vp8');
              expect(answer.sdp).to.contain('a=rtpmap:103 rtx');
              expect(answer.sdp).to.contain('a=fmtp:103 apt=102');
              expect(answer.sdp).not.to.contain('a=ssrc-group:FID ');
            });
        });
      });

      describe('with a local track', () => {
        it('creates an answer with RTX', () => {
          return navigator.mediaDevices.getUserMedia({video: true})
            .then((stream) => {
              pc.addStream(stream);
              return pc.setRemoteDescription({type: 'offer',
                sdp: sdp + remoteRTX});
            })
            .then(() => pc.createAnswer())
            .then((answer) => {
              expect(answer.sdp).to.contain('a=rtpmap:102 vp8');
              expect(answer.sdp).to.contain('a=rtpmap:103 rtx');
              expect(answer.sdp).to.contain('a=fmtp:103 apt=102');
              expect(answer.sdp).to.contain('a=ssrc-group:FID ');
            });
        });
      });

      describe('with no remote track', () => {
        it('creates an answer with RTX', () => {
          return navigator.mediaDevices.getUserMedia({video: true})
            .then((stream) => {
              pc.addStream(stream);
              return pc.setRemoteDescription({type: 'offer',
                sdp: sdp.replace('sendrecv', 'recvonly')});
            })
            .then(() => pc.createAnswer())
            .then((answer) => {
              expect(answer.sdp).to.contain('a=rtpmap:102 vp8');
              expect(answer.sdp).to.contain('a=rtpmap:103 rtx');
              expect(answer.sdp).to.contain('a=fmtp:103 apt=102');
              expect(answer.sdp).to.contain('a=ssrc-group:FID ');
            });
        });
      });

      describe('but mismatching video codec', () => {
        it('creates an answer without RTX', () => {
          const modifiedSDP = SDP_BOILERPLATE +
              'm=video 9 UDP/TLS/RTP/SAVPF 101 102 103\r\n' +
              'c=IN IP4 0.0.0.0\r\n' +
              'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
              'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
              'a=ice-pwd:' + ICEPWD + '\r\n' +
              'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
              'a=setup:actpass\r\n' +
              'a=mid:video1\r\n' +
              'a=sendrecv\r\n' +
              'a=rtcp-mux\r\n' +
              'a=rtcp-rsize\r\n' +
              'a=rtpmap:101 vp8/90000\r\n' +
              'a=rtpmap:102 no-such-codec/90000\r\n' +
              'a=rtpmap:103 rtx/90000\r\n' +
              'a=fmtp:103 apt=102\r\n';
          return pc.setRemoteDescription({type: 'offer', sdp: modifiedSDP})
            .then(() => pc.createAnswer())
            .then((answer) => {
              expect(answer.sdp).to.contain('a=rtpmap:101 vp8');
              expect(answer.sdp).not.to.contain('a=rtpmap:102 no-such-codec');
              expect(answer.sdp).not.to.contain('a=rtpmap:103 rtx');
              expect(answer.sdp).not.to.contain('a=fmtp:103 apt=102');
            });
        });
      });
    });

    describe('after a video offer without RTX', () => {
      const sdp = SDP_BOILERPLATE +
          'm=video 9 UDP/TLS/RTP/SAVPF 102\r\n' +
          'c=IN IP4 0.0.0.0\r\n' +
          'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
          'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
          'a=ice-pwd:' + ICEPWD + '\r\n' +
          'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
          'a=setup:actpass\r\n' +
          'a=mid:video1\r\n' +
          'a=sendrecv\r\n' +
          'a=rtcp-mux\r\n' +
          'a=rtcp-rsize\r\n' +
          'a=rtpmap:102 vp8/90000\r\n' +
          'a=ssrc:1001 msid:stream1 track1\r\n' +
          'a=ssrc:1001 cname:some\r\n';
      it('there is no ssrc-group in the answer', () => {
        return navigator.mediaDevices.getUserMedia({video: true})
          .then((stream) => {
            pc.addStream(stream);
            return pc.setRemoteDescription({type: 'offer', sdp});
          })
          .then(() => pc.createAnswer())
          .then((answer) => {
            expect(answer.sdp).not.to.contain('a=ssrc-group:FID ');
          });
      });
    });

    describe('after an offer containing a rejected mline', () => {
      it('rejects the m-line in the answer', () => {
        const sdp = SDP_BOILERPLATE +
            MINIMAL_AUDIO_MLINE.replace('m=audio 9', 'm=audio 0') +
            MINIMAL_AUDIO_MLINE.replace('m=audio 9', 'm=video 0')
              .replace('audio1', 'audio2');
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => pc.createAnswer())
          .then((answer) => {
            const sections = SDPUtils.getMediaSections(answer.sdp);
            expect(sections.length).to.equal(2);
            expect(SDPUtils.getKind(sections[0])).to.equal('audio');
            expect(SDPUtils.isRejected(sections[0])).to.equal(true);

            expect(SDPUtils.getKind(sections[1])).to.equal('video');
            expect(SDPUtils.isRejected(sections[1])).to.equal(true);
          });
      });
    });

    describe('rtcp-rsize is', () => {
      const sdp = SDP_BOILERPLATE +
          'm=video 9 UDP/TLS/RTP/SAVPF 102\r\n' +
          'c=IN IP4 0.0.0.0\r\n' +
          'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
          'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
          'a=ice-pwd:' + ICEPWD + '\r\n' +
          'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
          'a=setup:actpass\r\n' +
          'a=mid:video1\r\n' +
          'a=sendrecv\r\n' +
          'a=rtcp-mux\r\n' +
          'a=rtcp-rsize\r\n' +
          'a=rtpmap:102 vp8/90000\r\n' +
          'a=ssrc:1001 msid:stream1 track1\r\n' +
          'a=ssrc:1001 cname:some\r\n';

      it('set if the offer contained rtcp-rsize', () => {
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => pc.createAnswer())
          .then((answer) => {
            expect(answer.sdp).to.contain('a=rtcp-rsize\r\n');
          });
      });

      it('not set if the offer did not contain rtcp-rsize', () => {
        return pc.setRemoteDescription({type: 'offer',
          sdp: sdp.replace('a=rtcp-rsize\r\n', '')})
          .then(() => pc.createAnswer())
          .then((answer) => {
            expect(answer.sdp).not.to.contain('a=rtcp-rsize\r\n');
          });
      });
    });

    describe('with the remote offering BUNDLE', () => {
      let clock;
      beforeEach(() => {
        clock = sinon.useFakeTimers();
      });
      afterEach(() => {
        clock.restore();
      });

      const sdp = SDP_BOILERPLATE +
          'a=group:BUNDLE audio1 video1\r\n' +
          'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' +
          'c=IN IP4 0.0.0.0\r\n' +
          'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
          'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
          'a=ice-pwd:' + ICEPWD + '\r\n' +
          'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
          'a=setup:actpass\r\n' +
          'a=mid:audio1\r\n' +
          'a=sendonly\r\n' +
          'a=rtcp-mux\r\n' +
          'a=rtcp-rsize\r\n' +
          'a=rtpmap:111 opus/48000/2\r\n' +
          'a=ssrc:1001 cname:some\r\n' +
          'm=video 9 UDP/TLS/RTP/SAVPF 102\r\n' +
          'c=IN IP4 0.0.0.0\r\n' +
          'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
          'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
          'a=ice-pwd:' + ICEPWD + '\r\n' +
          'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
          'a=setup:actpass\r\n' +
          'a=mid:video1\r\n' +
          'a=sendrecv\r\n' +
          'a=rtcp-mux\r\n' +
          'a=rtcp-rsize\r\n' +
          'a=rtpmap:102 vp8/90000\r\n' +
          'a=ssrc:1002 cname:some\r\n';
      it('does not send candidates with sdpMLineIndex=1', (done) => {
        pc.onicecandidate = sinon.stub();
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') {
            expect(pc.onicecandidate).to.have.been.calledWith(sinon.match({
              candidate: sinon.match({sdpMLineIndex: sinon.match(0)})
            }));
            expect(pc.onicecandidate).not.to.have.been.calledWith(sinon.match({
              candidate: sinon.match({sdpMLineIndex: sinon.match(1)})
            }));
            done();
          }
        };
        pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => pc.createAnswer())
          .then((answer) => pc.setLocalDescription(answer))
          .then(() => {
            window.setTimeout(() => {
              clock.tick(500);
            });
            clock.tick(0);
          });
      });
    });

    describe('session version handling', () => {
      it('starts at version 0', () => {
        const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => pc.createAnswer())
          .then((answer) => {
            let ver = SDPUtils.matchPrefix(answer.sdp, 'o=')[0]
              .split(' ')[2] >>> 0;
            expect(ver).to.equal(0);
          });
      });

      it('subsequent calls increase the session version', () => {
        const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => pc.createAnswer())
          .then(() => pc.createAnswer())
          .then((answer) => {
            let ver = SDPUtils.matchPrefix(answer.sdp, 'o=')[0]
              .split(' ')[2] >>> 0;
            expect(ver).to.equal(1);
          });
      });
    });

    describe('with an audio-only offer adding an ' +
        'audio/video stream', () => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
      it('does not try to add a video m-line', () => {
        // https://github.com/webrtc/adapter/issues/638
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => navigator.mediaDevices.getUserMedia({audio: true,
            video: true}))
          .then((stream) => {
            pc.addStream(stream);
            return pc.createAnswer();
          })
          .then((answer) => {
            const sections = SDPUtils.getMediaSections(answer.sdp);
            expect(sections.length).to.equal(1);
          });
      });
    });

    it('keeps the order from the remote offer', () => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE +
        'm=video 9 UDP/TLS/RTP/SAVPF 102\r\n' +
        'c=IN IP4 0.0.0.0\r\n' +
        'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
        'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
        'a=ice-pwd:' + ICEPWD + '\r\n' +
        'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
        'a=setup:actpass\r\n' +
        'a=mid:video1\r\n' +
        'a=sendrecv\r\n' +
        'a=rtcp-mux\r\n' +
        'a=rtcp-rsize\r\n' +
        'a=rtpmap:102 vp8/90000\r\n';
      return navigator.mediaDevices.getUserMedia({audio: true, video: true})
        .then((stream) => {
          pc.addTrack(stream.getVideoTracks()[0], stream);
          pc.addTrack(stream.getAudioTracks()[0], stream);
        })
        .then(() => pc.setRemoteDescription({type: 'offer', sdp}))
        .then(() => pc.createAnswer())
        .then((answer) => {
          console.log(answer.sdp);
          const sections = SDPUtils.getMediaSections(answer.sdp);
          expect(SDPUtils.getKind(sections[0])).to.equal('audio');
          expect(SDPUtils.getKind(sections[1])).to.equal('video');
        });
    });

    it('only includes m-lines from the offer', () => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
      return navigator.mediaDevices.getUserMedia({video: true})
        .then((stream => pc.addTrack(stream.getTracks()[0], stream)))
        .then(() => pc.setRemoteDescription({type: 'offer', sdp}))
        .then(() => pc.createAnswer())
        .then((answer) => {
          const sections = SDPUtils.getMediaSections(answer.sdp);
          expect(sections.length).to.equal(1);
          expect(SDPUtils.getKind(sections[0])).to.equal('audio');
        });
    });
  });

  describe('addIceCandidate', () => {
    const sdp = SDP_BOILERPLATE +
        'a=group:BUNDLE audio1 video1\r\n' +
        'm=audio 9 UDP/TLS/RTP/SAVPF 98\r\n' +
        'c=IN IP4 0.0.0.0\r\n' +
        'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
        'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
        'a=ice-pwd:' + ICEPWD + '\r\n' +
        'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
        'a=setup:actpass\r\n' +
        'a=mid:audio1\r\n' +
        'a=sendrecv\r\n' +
        'a=rtcp-mux\r\n' +
        'a=rtcp-rsize\r\n' +
        'a=rtpmap:98 opus/48000/2\r\n' +
        'a=ssrc:1001 msid:stream1 track1\r\n' +
        'a=ssrc:1001 cname:some\r\n' +
        'm=video 9 UDP/TLS/RTP/SAVPF 102 103\r\n' +
        'c=IN IP4 0.0.0.0\r\n' +
        'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
        'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
        'a=ice-pwd:' + ICEPWD + '\r\n' +
        'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
        'a=setup:actpass\r\n' +
        'a=mid:video1\r\n' +
        'a=sendrecv\r\n' +
        'a=rtcp-mux\r\n' +
        'a=rtcp-rsize\r\n' +
        'a=rtpmap:102 vp8/90000\r\n' +
        'a=rtpmap:103 rtx/90000\r\n' +
        'a=fmtp:103 apt=102\r\n' +
        'a=ssrc-group:FID 1001 1002\r\n' +
        'a=ssrc:1001 msid:stream1 track1\r\n' +
        'a=ssrc:1001 cname:some\r\n' +
        'a=ssrc:1002 msid:stream1 track1\r\n' +
        'a=ssrc:1002 cname:some\r\n';
    const candidate = 'candidate:702786350 1 udp 41819902 8.8.8.8 ' +
        '60769 typ host';
    const sdpMid = 'audio1';

    let pc;
    beforeEach(() => {
      pc = new RTCPeerConnection();
      return pc.setRemoteDescription({type: 'offer', sdp});
    });
    afterEach(() => {
      pc.close();
    });

    it('returns a promise', (done) => {
      pc.addIceCandidate({sdpMid, candidate})
        .then(done);
    });

    it('calls the legacy success callback', (done) => {
      pc.addIceCandidate({sdpMid, candidate}, done, () => {});
    });

    it('throws a TypeError when called without sdpMid or ' +
        'sdpMLineIndex', () => {
      return pc.addIceCandidate({})
        .catch((e) => {
          expect(e.name).to.equal('TypeError');
        });
    });

    describe('rejects with an OperationError when called with an', () => {
      it('invalid sdpMid', () => {
        return pc.addIceCandidate({sdpMid: 'invalid', candidate})
          .catch((e) => {
            expect(e.name).to.equal('OperationError');
          });
      });

      it('invalid sdpMLineIndex', () => {
        return pc.addIceCandidate({sdpMLineIndex: 99, candidate})
          .catch((e) => {
            expect(e.name).to.equal('OperationError');
          });
      });
    });

    it('calls the legacy error callback when called with an ' +
        'invalid sdpMLineIndex', (done) => {
      pc.addIceCandidate({sdpMLineIndex: 99, candidate},
        () => {},
        (e) => {
          expect(e.name).to.equal('OperationError');
          done();
        }
      );
    });

    it('rejects with an InvalidStateError when called before ' +
       'setRemoteDescription', () => {
      pc = new RTCPeerConnection(); // recreate pc.
      return pc.addIceCandidate({sdpMid, candidate})
        .catch((e) => {
          expect(e.name).to.equal('InvalidStateError');
        });
    });

    it('adds the candidate to the remote description', () => {
      return pc.addIceCandidate({sdpMid, candidate})
        .then(() => {
          const sections = SDPUtils.getMediaSections(pc.remoteDescription.sdp);
          expect(SDPUtils.matchPrefix(sections[0],
            'a=candidate:')).to.have.length(1);
        });
    });

    it('adds the candidate to the remote description ' +
       'with legacy a=candidate syntax', () => {
      return pc.addIceCandidate({sdpMid, candidate: 'a=' + candidate})
        .then(() => {
          expect(SDPUtils.matchPrefix(pc.remoteDescription.sdp,
            'a=candidate:')).to.have.length(1);
        });
    });

    it('adds end-of-candidates when receiving the null candidate', () => {
      // add at least one valid candidate.
      pc.addIceCandidate({sdpMid, candidate});
      return pc.addIceCandidate()
        .then(() => {
          expect(SDPUtils.matchPrefix(pc.remoteDescription.sdp,
            'a=end-of-candidates')).to.have.length(1);
        });
    });

    it('adds end-of-candidates when receiving the \'\' candidate', () => {
      // add at least one valid candidate.
      pc.addIceCandidate({sdpMid, candidate});
      return pc.addIceCandidate({sdpMid, candidate: ''})
        .then(() => {
          expect(SDPUtils.matchPrefix(pc.remoteDescription.sdp,
            'a=end-of-candidates')).to.have.length(1);
        });
    });

    describe('ignores candidates with', () => {
      it('component=2 and does not add them to the sdp', () => {
        const iceTransport = pc.getReceivers()[0].transport.transport;
        sinon.spy(iceTransport, 'addRemoteCandidate');
        return pc.addIceCandidate({sdpMid, candidate:
          candidate.replace('1 udp', '2 udp')})
          .then(() => {
            expect(iceTransport.addRemoteCandidate)
              .not.to.have.been.calledWith();
            expect(SDPUtils.matchPrefix(pc.remoteDescription.sdp,
              'a=candidate:')).to.have.length(0);
          });
      });

      it('non-master mid but does add them to the sdp', () => {
        const iceTransport = pc.getReceivers()[0].transport.transport;
        sinon.spy(iceTransport, 'addRemoteCandidate');
        return pc.addIceCandidate({sdpMid: 'video1', candidate})
          .then(() => {
            expect(iceTransport.addRemoteCandidate)
              .not.to.have.been.calledWith();
            expect(SDPUtils.matchPrefix(pc.remoteDescription.sdp,
              'a=candidate:')).to.have.length(1);
          });
      });

      it('port 0 and does not add them to the sdp', () => {
        const iceTransport = pc.getReceivers()[0].transport.transport;
        sinon.spy(iceTransport, 'addRemoteCandidate');
        return pc.addIceCandidate({sdpMid, candidate:
          candidate.replace('60769', '0').replace('udp', 'tcp')})
          .then(() => {
            expect(iceTransport.addRemoteCandidate)
              .not.to.have.been.calledWith();
            expect(SDPUtils.matchPrefix(pc.remoteDescription.sdp,
              'a=candidate:')).to.have.length(0);
          });
      });

      it('port 9 and does not add them to the sdp', () => {
        const iceTransport = pc.getReceivers()[0].transport.transport;
        sinon.spy(iceTransport, 'addRemoteCandidate');
        return pc.addIceCandidate({sdpMid, candidate:
          candidate.replace('60769', '9').replace('udp', 'tcp')})
          .then(() => {
            expect(iceTransport.addRemoteCandidate)
              .not.to.have.been.calledWith();
            expect(SDPUtils.matchPrefix(pc.remoteDescription.sdp,
              'a=candidate:')).to.have.length(0);
          });
      });
    });
  });

  describe('negotiationneeded', () => {
    let pc;
    beforeEach(() => {
      pc = new RTCPeerConnection();
    });
    afterEach(() => {
      pc.close();
    });

    it('fires as an event', (done) => {
      const stub = sinon.stub();
      pc.addEventListener('negotiationneeded', stub);

      navigator.mediaDevices.getUserMedia({audio: true})
        .then((stream) => {
          pc.addTrack(stream.getAudioTracks()[0], stream);
        })
        .then(() => {
          setTimeout(() => {
            expect(stub).to.have.been.calledOnce();
            done();
          });
        });
    });

    describe('triggers after', () => {
      it('addTrack', (done) => {
        pc.onnegotiationneeded = sinon.stub();

        navigator.mediaDevices.getUserMedia({audio: true})
          .then((stream) => {
            pc.addTrack(stream.getAudioTracks()[0], stream);
          })
          .then(() => {
            setTimeout(() => {
              expect(pc.onnegotiationneeded).to.have.been.calledOnce();
              done();
            });
          });
      });

      it('addStream', (done) => {
        pc.onnegotiationneeded = sinon.stub();

        navigator.mediaDevices.getUserMedia({audio: true, video: true})
          .then((stream) => {
            pc.addStream(stream);
          })
          .then(() => {
            setTimeout(() => {
              expect(pc.onnegotiationneeded).to.have.been.calledOnce();
              done();
            });
          });
      });
    });

    it('does not trigger when already needing negotiation', (done) => {
      pc.onnegotiationneeded = sinon.stub();

      navigator.mediaDevices.getUserMedia({audio: true, video: true})
        .then((stream) => {
          stream.getTracks().forEach((track) => {
            pc.addTrack(track, stream);
          });
        })
        .then(() => {
          setTimeout(() => {
            expect(pc.onnegotiationneeded).to.have.been.calledOnce();
            done();
          });
        });
    });
  });

  describe('full cycle', () => {
    let pc1;
    let pc2;
    beforeEach(() => {
      pc1 = new RTCPeerConnection();
      pc2 = new RTCPeerConnection();
    });
    afterEach(() => {
      pc1.close();
      pc2.close();
    });

    it('completes a full createOffer-SLD-SRD-createAnswer-SLD-SRD ' +
       'cycle', () => {
      return navigator.mediaDevices.getUserMedia({audio: true, video: true})
        .then((stream) => {
          pc1.addStream(stream);
          pc2.addStream(stream);
          return pc1.createOffer();
        })
        .then((offer) => pc1.setLocalDescription(offer))
        .then(() => pc2.setRemoteDescription(pc1.localDescription))
        .then(() => pc2.createAnswer())
        .then((answer) => pc2.setLocalDescription(answer))
        .then(() => pc1.setRemoteDescription(pc2.localDescription))
        .then(() => {
          expect(pc1.signalingState).to.equal('stable');
          expect(pc2.signalingState).to.equal('stable');
        });
    });
  });

  describe('remote reoffer with role change', () => {
    let pc1;
    let pc2;
    beforeEach(() => {
      pc1 = new RTCPeerConnection();
      pc2 = new RTCPeerConnection();
    });
    afterEach(() => {
      pc1.close();
      pc2.close();
    });

    it('retains SSRCs', () => {
      return navigator.mediaDevices.getUserMedia({audio: true, video: true})
        .then((stream) => {
          pc1.addStream(stream);
          return pc1.createOffer();
        })
        .then((offer) => pc1.setLocalDescription(offer))
        .then(() => pc2.setRemoteDescription(pc1.localDescription))
        .then(() => pc2.createAnswer())
        .then((answer) => pc2.setLocalDescription(answer))
        .then(() => pc1.setRemoteDescription(pc2.localDescription))
        .then(() => navigator.mediaDevices
          .getUserMedia({audio: true, video: true}))
        .then((stream) => {
          pc2.addStream(stream);
          return pc2.createOffer();
        })
        .then((offer) => {
          const sections = SDPUtils.getMediaSections(offer.sdp);
          expect(sections.length).to.equal(2);
          const audioEncodingParameters = SDPUtils.parseRtpEncodingParameters(
            sections[0]);
          const videoEncodingParameters = SDPUtils.parseRtpEncodingParameters(
            sections[1]);
          expect(audioEncodingParameters[0].ssrc).to.equal(2002);
          expect(videoEncodingParameters[0].ssrc).to.equal(4004);
          expect(videoEncodingParameters[0].rtx.ssrc).to.equal(4005);
        });
    });

    it('sets the right DTLS role in the answer', () => {
      return navigator.mediaDevices.getUserMedia({audio: true, video: true})
        .then((stream) => {
          pc1.addStream(stream);
          return pc1.createOffer();
        })
        .then((offer) => pc1.setLocalDescription(offer))
        .then(() => pc2.setRemoteDescription(pc1.localDescription))
        .then(() => pc2.createAnswer())
        .then((answer) => pc2.setLocalDescription(answer))
        .then(() => pc1.setRemoteDescription(pc2.localDescription))
        .then(() => navigator.mediaDevices
          .getUserMedia({audio: true, video: true}))
        .then((stream) => {
          pc2.addStream(stream);
          return pc2.createOffer();
        })
        .then((offer) => pc2.setLocalDescription(offer))
        .then(() => pc1.setRemoteDescription(pc2.localDescription))
        .then(() => pc1.createAnswer())
        .then((answer) => {
          const sections = SDPUtils.getMediaSections(answer.sdp);
          expect(sections.length).to.equal(2);
          const setupLine = SDPUtils.matchPrefix(sections[0], 'a=setup:');
          expect(setupLine[0]).to.equal('a=setup:passive');
        });
    });
  });

  describe('bundlePolicy', () => {
    it('creates an offer with a=group:BUNDLE by default', () => {
      const pc = new RTCPeerConnection();

      return pc.createOffer({offerToReceiveAudio: true})
        .then((offer) => {
          expect(offer.sdp).to.contain('a=group:BUNDLE');
        });
    });

    it('max-compat creates an offer without a=group:BUNDLE', () => {
      const pc = new RTCPeerConnection({bundlePolicy: 'max-compat'});

      return pc.createOffer({offerToReceiveAudio: true})
        .then((offer) => {
          expect(offer.sdp).not.to.contain('a=group:BUNDLE');
        });
    });

    describe('emits candidates with sdpMLineIndex', () => {
      let clock;
      beforeEach(() => {
        clock = sinon.useFakeTimers();
      });
      afterEach(() => {
        clock.restore();
      });

      it('1 and 2 when using max-compat', (done) => {
        const pc = new RTCPeerConnection({bundlePolicy: 'max-compat'});

        pc.onicecandidate = sinon.stub();
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') {
            expect(pc.onicecandidate).to.have.been.calledWith(sinon.match({
              candidate: sinon.match({sdpMLineIndex: sinon.match(0)})
            }));
            expect(pc.onicecandidate).to.have.been.calledWith(sinon.match({
              candidate: sinon.match({sdpMLineIndex: sinon.match(1)})
            }));
            done();
          }
        };

        pc.createOffer({offerToReceiveAudio: true, offerToReceiveVideo: true})
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            window.setTimeout(() => {
              clock.tick(500);
            });
            clock.tick(0);
          });
      });

      it('1 when using max-bundle', (done) => {
        const pc = new RTCPeerConnection({bundlePolicy: 'max-bundle'});

        pc.onicecandidate = sinon.stub();
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') {
            expect(pc.onicecandidate).to.have.been.calledWith(sinon.match({
              candidate: sinon.match({sdpMLineIndex: sinon.match(0)})
            }));
            expect(pc.onicecandidate).not.to.have.been.calledWith(sinon.match({
              candidate: sinon.match({sdpMLineIndex: sinon.match(1)})
            }));
            done();
          }
        };

        pc.createOffer({offerToReceiveAudio: true, offerToReceiveVideo: true})
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            window.setTimeout(() => {
              clock.tick(500);
            });
            clock.tick(0);
          });
      });
    });
  });

  describe('getSenders', () => {
    let pc;
    beforeEach(() => {
      pc = new RTCPeerConnection();
    });
    afterEach(() => {
      pc.close();
    });

    it('returns an empty array initially', () => {
      expect(pc.getSenders().length).to.equal(0);
    });

    it('returns a single element after addTrack', () => {
      return navigator.mediaDevices.getUserMedia({audio: true})
        .then((stream) => {
          const track = stream.getTracks()[0];
          pc.addTrack(track, stream);
          const senders = pc.getSenders();
          expect(senders.length).to.equal(1);
          expect(senders[0].track).to.equal(track);
        });
    });
  });

  describe('getReceivers', () => {
    let pc;
    beforeEach(() => {
      pc = new RTCPeerConnection();
    });
    afterEach(() => {
      pc.close();
    });

    it('returns an empty array initially', () => {
      expect(pc.getReceivers().length).to.equal(0);
    });

    it('returns a single element after SRD with a track', () => {
      const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE +
          'a=ssrc:1001 msid:stream1 track1\r\n' +
          'a=ssrc:1001 cname:some\r\n';
      return pc.setRemoteDescription({type: 'offer', sdp})
        .then(() => {
          const receivers = pc.getReceivers();
          expect(receivers.length).to.equal(1);
          expect(receivers[0].track.kind).to.equal('audio');
        });
    });
  });

  describe('getLocalStreams', () => {
    let pc;
    beforeEach(() => {
      pc = new RTCPeerConnection();
    });
    afterEach(() => {
      pc.close();
    });

    it('returns an empty array initially', () => {
      expect(pc.getLocalStreams().length).to.equal(0);
    });

    describe('returns a single element after', () => {
      it('addTrack was called once', () => {
        return navigator.mediaDevices.getUserMedia({audio: true})
          .then((stream) => {
            const track = stream.getTracks()[0];
            pc.addTrack(track, stream);
          })
          .then(() => {
            const localStreams = pc.getLocalStreams();
            expect(localStreams.length).to.equal(1);
          });
      });

      it('addTrack was called twice with tracks from the ' +
         'same stream', () => {
        return navigator.mediaDevices.getUserMedia({audio: true, video: true})
          .then((stream) => {
            stream.getTracks().forEach(track => {
              pc.addTrack(track, stream);
            });
          })
          .then(() => {
            const localStreams = pc.getLocalStreams();
            expect(localStreams.length).to.equal(1);
          });
      });

      it('addStream was called', () => {
        return navigator.mediaDevices.getUserMedia({audio: true, video: true})
          .then((stream) => {
            pc.addStream(stream);
          })
          .then(() => {
            const localStreams = pc.getLocalStreams();
            expect(localStreams.length).to.equal(1);
          });
      });
    });

    describe('returns two streams after', () => {
      it('addTrack was called twice with tracks from two ' +
         'streams', () => {
        return navigator.mediaDevices.getUserMedia({audio: true})
          .then((stream) => {
            stream.getTracks().forEach(track => {
              pc.addTrack(track, stream);
            });
            return navigator.mediaDevices.getUserMedia({video: true});
          })
          .then((stream) => {
            stream.getTracks().forEach(track => {
              pc.addTrack(track, stream);
            });
          })
          .then(() => {
            const localStreams = pc.getLocalStreams();
            expect(localStreams.length).to.equal(2);
          });
      });

      it('addStream was called twice', () => {
        return navigator.mediaDevices.getUserMedia({audio: true})
          .then((stream) => {
            pc.addStream(stream);
            return navigator.mediaDevices.getUserMedia({video: true});
          })
          .then((stream) => {
            pc.addStream(stream);
          })
          .then(() => {
            const localStreams = pc.getLocalStreams();
            expect(localStreams.length).to.equal(2);
          });
      });
    });
  });

  describe('getRemoteStreams', () => {
    let pc;
    beforeEach(() => {
      pc = new RTCPeerConnection();
    });
    afterEach(() => {
      pc.close();
    });

    it('returns an empty array initially', () => {
      expect(pc.getRemoteStreams().length).to.equal(0);
    });

    describe('returns a single element after SRD', () => {
      it('with a single track', () => {
        const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE +
            'a=ssrc:1001 msid:stream1 track1\r\n' +
            'a=ssrc:1001 cname:some\r\n';
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => {
            const remoteStreams = pc.getRemoteStreams();
            expect(remoteStreams.length).to.equal(1);
          });
      });

      it('with two tracks in a single stream', () => {
        const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE +
            'a=ssrc:1001 msid:stream1 track1\r\n' +
            'a=ssrc:1001 cname:some\r\n' +
            MINIMAL_AUDIO_MLINE.replace('audio1', 'audio2') +
            'a=ssrc:1001 msid:stream1 track2\r\n' +
            'a=ssrc:1001 cname:some\r\n';
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => {
            const remoteStreams = pc.getRemoteStreams();
            expect(remoteStreams.length).to.equal(1);
          });
      });
    });

    describe('returns two streams after SRD', () => {
      it('with two tracks in two streams', () => {
        const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE +
            'a=ssrc:1001 msid:stream1 track1\r\n' +
            'a=ssrc:1001 cname:some\r\n' +
            MINIMAL_AUDIO_MLINE.replace('audio1', 'audio2') +
            'a=ssrc:1001 msid:stream2 track1\r\n' +
            'a=ssrc:1001 cname:some\r\n';
        return pc.setRemoteDescription({type: 'offer', sdp})
          .then(() => {
            const remoteStreams = pc.getRemoteStreams();
            expect(remoteStreams.length).to.equal(2);
          });
      });
    });
  });

  describe('removeTrack', () => {
    let pc;
    beforeEach(() => {
      pc = new RTCPeerConnection();
    });
    afterEach(() => {
      if (pc.signalingState !== 'closed') {
        pc.close();
      }
    });

    it('throws a TypeError if the argument is not an RTCRtpSender', () => {
      const removeTrack = () => {
        pc.removeTrack('something');
      };
      expect(removeTrack).to.throw(/does not implement/)
        .that.has.property('name').that.equals('TypeError');
    });

    it('throws an InvalidAccessError if the sender does not belong ' +
        'to the peerconnection', () => {
      const removeTrack = () => {
        pc.removeTrack(new window.RTCRtpSender('audio'));
      };
      expect(removeTrack).to.throw(/not created by/)
        .that.has.property('name').that.equals('InvalidAccessError');
    });

    it('throws an InvalidStateError if the peerconnection has been ' +
        'closed already', () => {
      pc.close();
      const removeTrack = () => {
        pc.removeTrack(new window.RTCRtpSender('audio'));
      };
      expect(removeTrack).to.throw()
        .that.has.property('name').that.equals('InvalidStateError');
    });

    it('makes the m-line recvonly', () => {
      return navigator.mediaDevices.getUserMedia({audio: true})
        .then((stream) => {
          const sender = pc.addTrack(stream.getAudioTracks()[0], stream);
          pc.removeTrack(sender);
          return pc.createOffer();
        })
        .then((offer) => {
          const sections = SDPUtils.getMediaSections(offer.sdp);
          expect(sections).to.have.length(1);
          expect(SDPUtils.getDirection(sections[0])).to.equal('recvonly');
        });
    });

    describe('and getLocalStreams', () => {
      it('removes local streams when the last sender has been removed', () => {
        return navigator.mediaDevices.getUserMedia({audio: true})
          .then((stream) => {
            const sender = pc.addTrack(stream.getAudioTracks()[0], stream);
            pc.removeTrack(sender);
            expect(pc.getLocalStreams()).to.have.length(0);
          });
      });

      it('keeps the local stream if there is a transceiver to which the ' +
         'stream belongs', () => {
        return navigator.mediaDevices.getUserMedia({audio: true, video: true})
          .then((stream) => {
            pc.addTrack(stream.getAudioTracks()[0], stream);
            const sender = pc.addTrack(stream.getVideoTracks()[0], stream);
            pc.removeTrack(sender);
            expect(pc.getLocalStreams()).to.have.length(1);
          });
      });
    });

    describe('legacy removeStream', () => {
      it('removes the stream from getLocalStreams', () => {
        return navigator.mediaDevices.getUserMedia({audio: true})
          .then((stream) => {
            pc.addStream(stream);
            pc.removeStream(stream);
            expect(pc.getLocalStreams()).to.have.length(0);
          });
      });

      it('makes the m-line recvonly', () => {
        return navigator.mediaDevices.getUserMedia({audio: true})
          .then((stream) => {
            pc.addStream(stream);
            pc.removeStream(stream);
            return pc.createOffer();
          })
          .then((offer) => {
            const sections = SDPUtils.getMediaSections(offer.sdp);
            expect(sections).to.have.length(1);
            expect(SDPUtils.getDirection(sections[0])).to.equal('recvonly');
          });
      });
    });
  });

  describe('addTrack', () => {
    let pc;
    beforeEach(() => {
      pc = new RTCPeerConnection();
    });
    afterEach(() => {
      pc.close();
    });

    describe('throws an exception', () => {
      it('if the track has already been added', () => {
        return navigator.mediaDevices.getUserMedia({audio: true})
          .then(stream => {
            pc.addTrack(stream.getTracks()[0], stream);
            const again = () => {
              pc.addTrack(stream.getTracks()[0], stream);
            };
            expect(again).to.throw(/already/)
              .that.has.property('name').that.equals('InvalidAccessError');
          });
      });

      it('if the track has already been added via addStream', () => {
        return navigator.mediaDevices.getUserMedia({audio: true})
          .then(stream => {
            pc.addStream(stream);
            const again = () => {
              pc.addTrack(stream.getTracks()[0], stream);
            };
            expect(again).to.throw(/already/)
              .that.has.property('name').that.equals('InvalidAccessError');
          });
      });

      it('if addStream is called with a stream containing a track ' +
         'already added', () => {
        return navigator.mediaDevices.getUserMedia({audio: true, video: true})
          .then(stream => {
            pc.addTrack(stream.getTracks()[0], stream);
            const again = () => {
              pc.addStream(stream);
            };
            expect(again).to.throw(/already/)
              .that.has.property('name').that.equals('InvalidAccessError');
          });
      });

      it('if the peerconnection has been closed already', () => {
        return navigator.mediaDevices.getUserMedia({audio: true})
          .then(stream => {
            pc.close();
            const afterClose = () => {
              pc.addTrack(stream.getTracks()[0], stream);
            };
            expect(afterClose).to.throw(/closed/)
              .that.has.property('name').that.equals('InvalidStateError');
          });
      });
    });
  });

  describe('getConfiguration', () => {
    let pc;
    it('fills in default values when no configuration is passed', () => {
      // do as jan-ivar says in
      // https://github.com/w3c/webrtc-pc/issues/1322#issuecomment-305878881
      pc = new RTCPeerConnection();
      const config = pc.getConfiguration();
      expect(config).to.be.an('Object');
      expect(config.bundlePolicy).to.equal('balanced');
      expect(config.iceCandidatePoolSize).to.equal(0);
      expect(config.iceServers).to.be.an('Array');
      expect(config.iceServers.length).equal(0);
      expect(config.iceTransportPolicy).to.equal('all');
      expect(config.rtcpMuxPolicy).to.equal('require');
    });
  });

  describe('getStats', () => {
    let pc;
    const sdp = SDP_BOILERPLATE + MINIMAL_AUDIO_MLINE;
    beforeEach(() => {
      pc = new RTCPeerConnection();
      return navigator.mediaDevices.getUserMedia({audio: true})
        .then((stream) => {
          pc.addTrack(stream.getAudioTracks()[0], stream);
          return pc.setRemoteDescription({type: 'offer', sdp});
        })
        .then(() => pc.createAnswer())
        .then(answer => pc.setLocalDescription(answer));
    });
    afterEach(() => {
      pc.close();
    });

    it('returns a promise', (done) => {
      pc.getStats()
        .then(() => {
          done();
        });
    });

    it('calls the legacy success callback', (done) => {
      pc.getStats(null, () => {
        done();
      });
    });

    it('hyphenates stats', () => {
      return pc.getStats()
        .then(stats => {
          let hasOutbound = false;
          stats.forEach(stat => hasOutbound |= (stat.type === 'outbound-rtp'));
          expect(hasOutbound).to.equal(1); // |= changes to 1.
        });
    });

    describe('with a track selector', () => {
      it('calls getStats on the sender', () => {
        const sender = pc.getSenders()[0];
        sinon.spy(sender, 'getStats');
        return pc.getStats(sender.track)
          .then(() => {
            expect(sender.getStats).to.have.been.calledOnce();
          });
      });

      it('calls getStats on the receiver', () => {
        let receiver = pc.getReceivers()[0];
        sinon.spy(receiver, 'getStats');
        return pc.getStats(receiver.track)
          .then(() => {
            expect(receiver.getStats).to.have.been.calledOnce();
          });
      });

      it('throws an InvalidAccessError if the track is not assocіated', () => {
        const getStats = () => {
          pc.getStats(new window.MediaStreamTrack());
        };
        expect(getStats).to.throw()
          .that.has.property('name').that.equals('InvalidAccessError');
      });
    });
  });

  describe('RTCIceCandidate contains a port property in', () => {
    it('the onicecandidate callback', (done) => {
      let hasProperty = false;
      const pc = new RTCPeerConnection();
      pc.onicecandidate = (e) => {
        if (!e.candidate) {
          expect(hasProperty).to.equal(true);
          done();
        } else {
          hasProperty = e.candidate.hasOwnProperty('port');
        }
      };
      pc.createOffer({offerToReceiveAudio: true})
        .then(offer => pc.setLocalDescription(offer));
    });

    it('the icecandidate event', (done) => {
      let hasProperty = false;
      const pc = new RTCPeerConnection();
      pc.addEventListener('icecandidate', (e) => {
        if (!e.candidate) {
          expect(hasProperty).to.equal(true);
          done();
        } else {
          hasProperty = e.candidate.hasOwnProperty('port');
        }
      });
      pc.createOffer({offerToReceiveAudio: true})
        .then(offer => pc.setLocalDescription(offer));
    });
  });

  describe('_updateIceConnectionState', () => {
    let pc;
    beforeEach(() => {
      pc = new RTCPeerConnection();
      return pc.createOffer({offerToReceiveAudio: 1});
    });
    afterEach(() => {
      pc.close();
    });

    it('calls both event and oicenconnectionstatechange', () => {
      pc._iceConnectionState = 'weird state';

      const stub = sinon.stub();
      pc.oniceconnectionstatechange = stub;
      pc.addEventListener('iceconnectionstatechange', stub);

      pc._updateIceConnectionState();

      expect(stub).to.have.been.calledTwice();
      expect(pc.iceConnectionState).to.equal('new');
    });

    describe('emits connectionstatechange when ice is', () => {
      ['checking', 'connected', 'completed', 'disconnected', 'failed']
        .forEach(state => {
          it(state, () => {
            const receiver = pc.getReceivers()[0];
            const dtlsTransport = receiver.transport;
            const iceTransport = dtlsTransport.transport;
            iceTransport.state = state;

            const stub = sinon.stub();
            pc.oniceconnectionstatechange = stub;

            iceTransport.dispatchEvent(new Event('icestatechange'));

            expect(stub).to.have.been.calledOnce();
            expect(pc.iceConnectionState).to.equal(state);
          });
        });
    });
  });

  describe('_updateConnectionState', () => {
    let pc;
    beforeEach(() => {
      pc = new RTCPeerConnection();
      return pc.createOffer({offerToReceiveAudio: 1});
    });
    afterEach(() => {
      pc.close();
    });

    it('calls both event and onconnectionstatechange', () => {
      pc._connectionState = 'weird state';

      const stub = sinon.stub();
      pc.onconnectionstatechange = stub;
      pc.addEventListener('connectionstatechange', stub);

      pc._updateConnectionState();

      expect(stub).to.have.been.calledTwice();
      expect(pc.connectionState).to.equal('new');
    });

    it('does not emit connectionstatechange when just the ' +
       'ice connection changes', () => {
      const receiver = pc.getReceivers()[0];
      const dtlsTransport = receiver.transport;
      const iceTransport = dtlsTransport.transport;
      iceTransport.state = 'connected';

      const stub = sinon.stub();
      pc.onconnectionstatechange = stub;
      pc.addEventListener('connectionstatechange', stub);

      iceTransport.dispatchEvent(new Event('icestatechange'));
      expect(stub).not.to.have.been.calledWith();
    });

    it('emits connectionstatechange when ice and dtls are connected', () => {
      const receiver = pc.getReceivers()[0];
      const dtlsTransport = receiver.transport;
      const iceTransport = dtlsTransport.transport;

      iceTransport.state = 'connected';
      dtlsTransport.state = 'connected';

      const stub = sinon.stub();
      pc.onconnectionstatechange = stub;

      dtlsTransport.dispatchEvent(new Event('dtlsstatechange'));

      expect(stub).to.have.been.calledOnce();
      expect(pc.connectionState).to.equal('connected');
    });

    it('changes the connection state to connecting when the dtls transports ' +
       'start connecting', () => {
      const receiver = pc.getReceivers()[0];
      const dtlsTransport = receiver.transport;
      dtlsTransport.state = 'connecting';
      const stub = sinon.stub();
      pc.onconnectionstatechange = stub;

      dtlsTransport.dispatchEvent(new Event('dtlsstatechange'));

      expect(stub).to.have.been.calledOnce();
      expect(pc.connectionState).to.equal('connecting');
    });

    it('changes the connection state to failed when there ' +
       'was a DTLS error', () => {
      const receiver = pc.getReceivers()[0];
      const dtlsTransport = receiver.transport;

      const stub = sinon.stub();
      pc.onconnectionstatechange = stub;

      dtlsTransport.dispatchEvent(new Event('error'));
      expect(stub).to.have.been.calledOnce();
      expect(pc.connectionState).to.equal('failed');
    });

    it('changes the connection state to disconnected when the ICE ' +
        'connection disconnects', () => {
      pc.connectionState = 'connected';

      const receiver = pc.getReceivers()[0];
      const dtlsTransport = receiver.transport;
      const iceTransport = dtlsTransport.transport;

      iceTransport.state = 'disconnected';
      dtlsTransport.state = 'connected';

      const stub = sinon.stub();
      pc.onconnectionstatechange = stub;

      iceTransport.dispatchEvent(new Event('icestatechange'));

      expect(stub).to.have.been.calledOnce();
      expect(pc.iceConnectionState).to.equal('disconnected');
    });
  });

  describe('addTrack', () => {
    let pc;
    let audioTrack;
    beforeEach(() => {
      pc = new RTCPeerConnection();
      return navigator.mediaDevices.getUserMedia({audio: true})
        .then((stream) => {
          audioTrack = stream.getAudioTracks()[0];
        });
    });

    it('returns a sender whose transport is not set', () => {
      const sender = pc.addTrack(audioTrack);
      expect(sender).to.be.an.instanceOf(window.RTCRtpSender);
      expect(sender.transport).to.equal(null);
    });
  });

  describe('edge pre-rtx behaviour', () => {
    let pc;
    beforeEach(() => {
      RTCPeerConnection = shimPeerConnection(window, 15000); // must be < 15019
      pc = new RTCPeerConnection();
    });
    afterEach(() => {
      pc.close();
    });

    it('does not create an offer with RTX', () => {
      return pc.createOffer({offerToReceiveVideo: true})
        .then((offer) => {
          expect(offer.sdp).not.to.contain(' rtx/90000');
        });
    });

    it('does not answer with RTX', () => {
      const sdp = SDP_BOILERPLATE +
          'm=video 9 UDP/TLS/RTP/SAVPF 102 103\r\n' +
          'c=IN IP4 0.0.0.0\r\n' +
          'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
          'a=ice-ufrag:' + ICEUFRAG + '\r\n' +
          'a=ice-pwd:' + ICEPWD + '\r\n' +
          'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
          'a=setup:actpass\r\n' +
          'a=mid:video1\r\n' +
          'a=sendrecv\r\n' +
          'a=rtcp-mux\r\n' +
          'a=rtcp-rsize\r\n' +
          'a=rtpmap:102 vp8/90000\r\n' +
          'a=rtpmap:103 rtx/90000\r\n' +
          'a=fmtp:103 apt=102\r\n' +
          'a=ssrc-group:FID 1001 1002\r\n' +
          'a=ssrc:1001 msid:stream1 track1\r\n' +
          'a=ssrc:1001 cname:some\r\n' +
          'a=ssrc:1002 msid:stream1 track1\r\n' +
          'a=ssrc:1002 cname:some\r\n';
      return navigator.mediaDevices.getUserMedia({video: true})
        .then((stream) => {
          pc.addTrack(stream.getTracks()[0], stream);
          return pc.setRemoteDescription({type: 'offer', sdp});
        })
        .then(() => pc.createAnswer())
        .then((answer) => {
          expect(answer.sdp).not.to.contain(' rtx/90000');
        });
    });
  });

  describe('non-rtx answer to rtx', () => {
    let pc;
    beforeEach(() => {
      pc = new RTCPeerConnection();
    });
    afterEach(() => {
      pc.close();
    });
    it('does not call send() with RTX', () => {
      let sender;
      return navigator.mediaDevices.getUserMedia({video: true})
        .then((stream) => {
          sender = pc.addTrack(stream.getTracks()[0], stream);
          sender.send = sinon.stub();
        })
        .then(() => pc.createOffer())
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          const localMid = SDPUtils.getMid(
            SDPUtils.splitSections(pc.localDescription.sdp)[1]);
          const candidate = 'a=candidate:702786350 1 udp 41819902 ' +
              '8.8.8.8 60769 typ host';
          const sdp = 'v=0\r\n' +
              'o=- 0 0 IN IP4 127.0.0.1\r\n' +
              's=nortxanswer\r\n' +
              't=0 0\r\n' +
              'm=video 1 UDP/TLS/RTP/SAVPF 100\r\n' +
              'c=IN IP4 0.0.0.0\r\n' +
              'a=rtpmap:100 VP8/90000\r\n' +
              'a=rtcp:1 IN IP4 0.0.0.0\r\n' +
              'a=rtcp-fb:100 nack\r\n' +
              'a=rtcp-fb:100 nack pli\r\n' +
              'a=rtcp-fb:100 goog-remb\r\n' +
              'a=extmap:1 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time\r\n' +
              'a=setup:active\r\n' +
              'a=mid:' + localMid + '\r\n' +
              'a=recvonly\r\n' +
              'a=ice-ufrag:S5Zq\r\n' +
              'a=ice-pwd:6E1muhzVwnphsbN6uokNU/\r\n' +
              'a=fingerprint:sha-256 ' + FINGERPRINT_SHA256 + '\r\n' +
              candidate + '\r\n' +
              'a=end-of-candidates\r\n' +
              'a=rtcp-mux\r\n';
          return pc.setRemoteDescription({type: 'answer', sdp});
        })
        .then(() => {
          expect(sender.send).to.have.been.calledWith(
            sinon.match.has('encodings', [{ssrc: 1001}]));
        });
    });
  });

  describe('edge clonestream issue', () => {
    let pc;
    beforeEach(() => {
      RTCPeerConnection = shimPeerConnection(window, 15000); // must be < 15025
      pc = new RTCPeerConnection();
    });
    afterEach(() => {
      pc.close();
    });

    it('clones the stream before addStream', () => {
      return navigator.mediaDevices.getUserMedia({video: true})
        .then((stream) => {
          stream.clone = sinon.stub().returns(stream);
          pc.addStream(stream);
          expect(stream.clone).to.have.been.calledOnce();
        });
    });

    it('triggers the enabled event on the cloned track and sets enabled ' +
       'when triggered on the original track', () => {
      return navigator.mediaDevices.getUserMedia({video: true})
        .then((originalStream) => {
          const originalTrack = originalStream.getTracks()[0];
          pc.addStream(originalStream);

          const clonedTrack = pc.getLocalStreams()[0].getTracks()[0];
          const e = new Event('MediaStreamTrackEvent');
          e.type = 'enabled';
          e.enabled = false;
          originalTrack.dispatchEvent(e);
          expect(clonedTrack.enabled).to.equal(false);
        });
    });
  });
});
