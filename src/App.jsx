import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';

const socket = io('http://192.168.88.237:4400'); // Replace with your server URL

function App() {
  const [roomId, setRoomId] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const localVideoRef = useRef(null);
  const remoteVideosRef = useRef({}); // Object to store refs for remote videos

  let device, producerTransport, consumerTransport, producer;

  // Function to join the room
  const joinRoom = async () => {
    setIsJoined(true);
    
    // Create the room on the server
    socket.emit('createRoom', roomId, async (data) => {
      if (data.error) {
        console.error(data.error);
        return;
      }
  
      // Load Mediasoup device with router capabilities
      device = new mediasoupClient.Device();
      // console.log(device);
      
      await device.load({ routerRtpCapabilities: data.routerRtpCapabilities });
  
      // After creating the room, join the room
      socket.emit('joinRoom', { roomId, peerId: socket.id }, (transportData) => {
        if (transportData.error) {
          console.error(transportData.error);
          return;
        }
  
        // Now create the producer transport
        createProducerTransport(transportData.transportOptions);
      });
    });
  };
  
  const createProducerTransport = async (transportOptions) => {
    producerTransport = device.createSendTransport(transportOptions);
  
    producerTransport.on('connect', ({ dtlsParameters }, callback) => {
      socket.emit('connectTransport', { roomId, dtlsParameters }, callback);
    });
  
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideoRef.current.srcObject = stream;
  
    const track = stream.getVideoTracks()[0];
    producer = await producerTransport.produce({ track });
  
    socket.on('newProducer', handleNewProducer);
  };
  

  // Function to create a WebRTC transport
  const createTransport = async (type) => {
    return new Promise((resolve, reject) => {
      socket.emit('createWebRtcTransport', { roomId, type }, (transportData) => {
        let transport;
  
        if (type === 'producer') {
          transport = device.createSendTransport(transportData);
  
          // Gérer l'événement "produce"
          transport.on('produce', async ({ kind, rtpParameters }, callback) => {
            try {
              // Envoyer au serveur pour produire un flux
              socket.emit('produce', { roomId, kind, rtpParameters }, (data) => {
                if (data.error) {
                  console.error('Error producing stream:', data.error);
                  return;
                }
                // Répondre avec l'ID du producteur pour compléter la production
                callback({ id: data.id });
              });
            } catch (error) {
              console.error('Error in produce event:', error);
            }
          });
        } else {
          // Pour le consommateur
          transport = device.createRecvTransport(transportData);
        }
  
        transport.on('connect', ({ dtlsParameters }, callback) => {
          socket.emit('connectTransport', { roomId, dtlsParameters }, callback);
        });
  
        resolve(transport);
      });
    });
  };  
  

  // Function to handle when a new producer joins the room
  const handleNewProducer = async ({ producerId }) => {
    consumerTransport = await createTransport('consumer');
    
    // Request the server to consume the new producer's media
    socket.emit('consume', { producerId, roomId, rtpCapabilities: device.rtpCapabilities }, async (data) => {
      const { id, kind, rtpParameters } = data;

      const consumer = await consumerTransport.consume({
        id,
        producerId,
        kind,
        rtpParameters,
      });

      // Create a new media stream for the consumer
      const stream = new MediaStream();
      stream.addTrack(consumer.track);

      // Create a new video element for the remote stream
      const videoRef = document.createElement('video');
      videoRef.autoplay = true;
      videoRef.playsInline = true;
      videoRef.muted = false;
      videoRef.srcObject = stream;

      // Append video to the DOM and update the state
      document.getElementById('remoteVideosContainer').appendChild(videoRef);
      remoteVideosRef.current[producerId] = videoRef;
    });
  };

  return (
    <div>
      <h2>Mediasoup Video Conference</h2>
      {!isJoined ? (
        <div>
          <input
            type="text"
            placeholder="Enter Room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          />
          <button onClick={joinRoom}>Join Room</button>
        </div>
      ) : (
        <div>
          <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '300px' }}></video>
          <div id="remoteVideosContainer"></div>
        </div>
      )}
    </div>
  );
}

export default App;
