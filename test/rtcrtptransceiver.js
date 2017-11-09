/*
 *  Copyright (c) 2017 Philipp Hancke. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
/* eslint-env node */
'use strict';

const chai = require('chai');
const expect = chai.expect;

const shimRTCRtpTransceiver = require('../rtcrtptransceiver');
const RTCTransceiver = shimRTCRtpTransceiver();

function mockTransceiver() {
  return {
    mid: 'mock mid',
    rtpSender: 'mock sender',
    rtpReceiver: 'mock receiver',
    direction: 'mock direction'
  };
}

describe('RTCRtpTransceiver', () => {
  let transceiver;
  beforeEach(() => {
    transceiver = new RTCTransceiver(mockTransceiver());
  });

  it('returns the transceiver mid', () => {
    expect(transceiver.mid).to.equal('mock mid');
  });

  it('returns the transceiver sender', () => {
    expect(transceiver.sender).to.equal('mock sender');
  });

  it('returns the transceiver receiver', () => {
    expect(transceiver.receiver).to.equal('mock receiver');
  });

  it('returns the transceiver direction', () => {
    expect(transceiver.direction).to.equal('mock direction');
  });

  it('returns the transceiver default sendrecv direction', () => {
    transceiver = new RTCTransceiver({});
    expect(transceiver.direction).to.equal('sendrecv');
  });

  it('sets the internal direction', () => {
    const internalTransceiver = {direction: 'something'};
    transceiver = new RTCTransceiver(internalTransceiver);
    transceiver.direction = 'sendrecv';
    expect(internalTransceiver.direction).to.equal('sendrecv');
  });
});
