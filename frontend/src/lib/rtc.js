import { api } from "./api";

export async function startRtc(readingId, mediaType, onRemoteTrack) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: mediaType === "video",
  });

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
    bundlePolicy: "max-bundle",
  });

  pc.ontrack = (event) => onRemoteTrack(event);

  const transceivers = stream.getTracks().map((track) =>
    pc.addTransceiver(track, { direction: "sendonly" })
  );

  const { data: sess } = await api.post(`/rtc/${readingId}/session`);
  const sessionId = sess.sessionId;

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // mids are only assigned after setLocalDescription
  const localTracks = transceivers.map((t) => ({
    mid: t.mid,
    trackName: t.sender.track.kind + "-" + sessionId.slice(0, 8),
  }));

  const { data: pushRes } = await api.post(`/rtc/${readingId}/tracks/local`, {
    sessionId,
    sdp: pc.localDescription.sdp,
    tracks: localTracks,
  });
  await pc.setRemoteDescription(new RTCSessionDescription(pushRes.sessionDescription));

  let pulled = false;
  const pullRemote = async () => {
    if (pulled) return true;
    const { data: remote } = await api.get(`/rtc/${readingId}/remote`);
    if (!remote.ready) return false;
    pulled = true;
    const { data: pullRes } = await api.post(`/rtc/${readingId}/tracks/remote`, {
      sessionId,
      remoteSessionId: remote.sessionId,
      trackNames: remote.trackNames,
    });
    if (pullRes.requiresImmediateRenegotiation) {
      await pc.setRemoteDescription(new RTCSessionDescription(pullRes.sessionDescription));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await api.put(`/rtc/${readingId}/renegotiate`, { sessionId, sdp: answer.sdp });
    }
    return true;
  };

  const pollInterval = setInterval(async () => {
    try {
      const done = await pullRemote();
      if (done) clearInterval(pollInterval);
    } catch (e) {
      // keep polling
    }
  }, 2000);

  return {
    pc,
    stream,
    stop: () => {
      clearInterval(pollInterval);
      stream.getTracks().forEach((t) => t.stop());
      pc.close();
    },
    toggleAudio: () => {
      const t = stream.getAudioTracks()[0];
      if (t) t.enabled = !t.enabled;
      return t ? t.enabled : false;
    },
    toggleVideo: () => {
      const t = stream.getVideoTracks()[0];
      if (t) t.enabled = !t.enabled;
      return t ? t.enabled : false;
    },
  };
}
