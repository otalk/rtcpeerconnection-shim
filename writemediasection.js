/*
 *  Copyright (c) 2018 rtcpeerconnection-shim authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

var SDPUtils = require('sdp');
/* generates a m= SDP from a transceiver. */
function writeMediaSection(transceiver, caps, type, stream, dtlsRole) {
  var sdp = SDPUtils.writeRtpDescription(transceiver.kind, caps);

  // Map ICE parameters (ufrag, pwd) to SDP.
  sdp += SDPUtils.writeIceParameters(
    transceiver.iceGatherer.getLocalParameters());

  // Map DTLS parameters to SDP.
  sdp += SDPUtils.writeDtlsParameters(
    transceiver.dtlsTransport.getLocalParameters(),
    type === 'offer' ? 'actpass' : dtlsRole);

  sdp += 'a=mid:' + transceiver.mid + '\r\n';

  if (transceiver.rtpSender && transceiver.rtpReceiver) {
    sdp += 'a=sendrecv\r\n';
  } else if (transceiver.rtpSender) {
    sdp += 'a=sendonly\r\n';
  } else if (transceiver.rtpReceiver) {
    sdp += 'a=recvonly\r\n';
  } else {
    sdp += 'a=inactive\r\n';
  }

  if (transceiver.rtpSender) {
    var trackId = transceiver.rtpSender._initialTrackId ||
        transceiver.rtpSender.track.id;
    transceiver.rtpSender._initialTrackId = trackId;
    // spec.
    var msid = 'msid:' + (stream ? stream.id : '-') + ' ' +
        trackId + '\r\n';
    sdp += 'a=' + msid;
    // for Chrome. Legacy should no longer be required.
    sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].ssrc +
        ' ' + msid;

    // RTX
    if (transceiver.sendEncodingParameters[0].rtx) {
      sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].rtx.ssrc +
          ' ' + msid;
      sdp += 'a=ssrc-group:FID ' +
          transceiver.sendEncodingParameters[0].ssrc + ' ' +
          transceiver.sendEncodingParameters[0].rtx.ssrc +
          '\r\n';
    }
  }
  // FIXME: this should be written by writeRtpDescription.
  sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].ssrc +
      ' cname:' + SDPUtils.localCName + '\r\n';
  if (transceiver.rtpSender && transceiver.sendEncodingParameters[0].rtx) {
    sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].rtx.ssrc +
        ' cname:' + SDPUtils.localCName + '\r\n';
  }
  return sdp;
}

/* generates a m= SDP from a rejected transceiver. */
function writeRejectedMediaSection(transceiver) {
  var sdp = '';
  if (transceiver.kind === 'application') {
    if (transceiver.protocol === 'DTLS/SCTP') { // legacy fmt
      sdp += 'm=application 0 DTLS/SCTP 5000\r\n';
    } else {
      sdp += 'm=application 0 ' + transceiver.protocol +
        ' webrtc-datachannel\r\n';
    }
  } else if (transceiver.kind === 'audio') {
    sdp += 'm=audio 0 UDP/TLS/RTP/SAVPF 0\r\n' +
      'a=rtpmap:0 PCMU/8000\r\n';
  } else if (transceiver.kind === 'video') {
    sdp += 'm=video 0 UDP/TLS/RTP/SAVPF 120\r\n' +
      'a=rtpmap:120 VP8/90000\r\n';
  }
  sdp += 'c=IN IP4 0.0.0.0\r\n' +
    'a=inactive\r\n' +
    'a=mid:' + transceiver.mid + '\r\n';
  return sdp;
}

module.exports = {
  writeMediaSection: writeMediaSection,
  writeRejectedMediaSection: writeRejectedMediaSection
};
