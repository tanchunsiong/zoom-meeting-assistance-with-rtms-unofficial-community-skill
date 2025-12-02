import express from 'express';
import crypto from 'crypto';
import { WebSocket, WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import fs from 'fs';
import helmet from 'helmet'; //used for CSP and security headers
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { resetTranscriptForStream, setStreamStartTimestamp } from './writeTranscriptToVtt.js';

//used for saving audio and video frm RTMS stream
import { saveRawAudio as saveRawAudioAdvance } from './saveRawAudioAdvance.js';
import { saveRawVideo as saveRawVideoAdvance } from './saveRawVideoAdvance.js';

//used for saving transcript
import { writeTranscriptToVtt } from './writeTranscriptToVtt.js';

//used for saving screenshare 
import { handleShareData, generatePDFAndText } from './saveSharescreen.js';



//video process with ffmpeg post meeting
import { convertMeetingMedia } from './convertMeetingMedia.js';
import { muxFirstAudioVideo } from './muxFirstAudioVideo.js';

import { sanitizeFileName } from './tool.js';



// Load environment variables from a .env file
dotenv.config();


// Dynamic AI provider loading based on .env setting
let aiFunctions = {};

async function loadAIProvider() {
  const provider = process.env.AI_PROVIDER || 'openrouter';

  if (provider === 'gemma') {
    console.log('🔄 Loading Gemma provider...');
    const { chatWithGemma, chatWithGemmaFast, generateDialogSuggestions, analyzeSentiment, generateRealTimeSummary, queryCurrentMeeting } = await import('./chatWithGemma.js');
    aiFunctions = { chat: chatWithGemma, chatFast: chatWithGemmaFast, generateDialogSuggestions, analyzeSentiment, generateRealTimeSummary, queryCurrentMeeting };
  } else if (provider === 'qwen') {
    console.log('🔄 Loading Qwen provider...');
    const { chatWithQwen, chatWithQwenFast, generateDialogSuggestions, analyzeSentiment, generateRealTimeSummary, queryCurrentMeeting } = await import('./chatWithQwen.js');
    aiFunctions = { chat: chatWithQwen, chatFast: chatWithQwenFast, generateDialogSuggestions, analyzeSentiment, generateRealTimeSummary, queryCurrentMeeting };
  } else if (provider === 'deepseek') {
    console.log('🔄 Loading DeepSeek provider...');
    const { chatWithDeepSeek, chatWithDeepSeekFast, generateDialogSuggestions, analyzeSentiment, generateRealTimeSummary, queryCurrentMeeting } = await import('./chatWithDeepSeek.js');
    aiFunctions = { chat: chatWithDeepSeek, chatFast: chatWithDeepSeekFast, generateDialogSuggestions, analyzeSentiment, generateRealTimeSummary, queryCurrentMeeting };
  } else {
    console.log('🔄 Loading OpenRouter provider...');
    const { chatWithOpenRouter, chatWithOpenRouterFast, generateDialogSuggestions, analyzeSentiment, generateRealTimeSummary, queryCurrentMeeting } = await import('./chatWithOpenrouter.js');
    aiFunctions = { chat: chatWithOpenRouter, chatFast: chatWithOpenRouterFast, generateDialogSuggestions, analyzeSentiment, generateRealTimeSummary, queryCurrentMeeting };
  }

  console.log(`✅ AI provider loaded: ${provider}`);
}


const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const port = process.env.PORT || 3000;
const execAsync = promisify(exec);

const ZOOM_SECRET_TOKEN = process.env.ZOOM_SECRET_TOKEN;
const CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || '/webhook';


// Middleware to parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://appssdk.zoom.us; style-src 'self' 'unsafe-inline'; object-src 'none';"
  );
  next();
});

// Serve static files (HTML, JS, etc.)
app.use(express.static(__dirname));

// Map to keep track of active WebSocket connections and audio chunks (stream_id -> connection data)
const activeConnections = new Map();

// WebSocket connection store for clients (stream_id -> [clientWs1, clientWs2, ...])  
const clientWebSocketConnections = new Map();

// AI Results cache per meeting (stream_id -> {dialog, sentiment, lastUpdated})
const aiCache = new Map();


// Handle POST requests to the webhook endpoint
app.post(WEBHOOK_PATH, async (req, res) => {
  // Respond with HTTP 200 status
  res.sendStatus(200);
  console.log('RTMS Webhook received:', JSON.stringify(req.body, null, 2));
  const { event, payload } = req.body;

  // Handle URL validation event
  if (event === 'endpoint.url_validation' && payload?.plainToken) {
    // Generate a hash for URL validation using the plainToken and a secret token
    const hash = crypto
      .createHmac('sha256', ZOOM_SECRET_TOKEN)
      .update(payload.plainToken)
      .digest('hex');
    console.log('Responding to URL validation challenge');
    return res.json({
      plainToken: payload.plainToken,
      encryptedToken: hash,
    });
  }

  // Handle RTMS started event
  if (event === 'meeting.rtms_started') {
    console.log('RTMS Started event received');
    const { meeting_uuid, rtms_stream_id, server_urls } = payload;
    // Initiate connection to the signaling WebSocket server
    connectToSignalingWebSocket(meeting_uuid, rtms_stream_id, server_urls);
  }

  // Handle RTMS stopped event
  if (event === 'meeting.rtms_stopped') {
    console.log('RTMS Stopped event received');

    const { meeting_uuid, rtms_stream_id, server_urls } = payload;
    // Close all active WebSocket connections for the given meeting UUID
    if (activeConnections.has(rtms_stream_id)) {
      const connections = activeConnections.get(rtms_stream_id);
      console.log('Closing active connections for stream: ' + rtms_stream_id);
      for (const conn of Object.values(connections)) {
        if (conn && typeof conn.close === 'function') {
          conn.close();
        }
      }
      activeConnections.delete(rtms_stream_id);
    }

    // Broadcast stream ended event to frontend clients connected to this stream
    broadcastToWebSocketClients({
      type: 'stream_ended',
      meeting_uuid: meeting_uuid,
      stream_id: rtms_stream_id
    }, rtms_stream_id);

    console.log('Starting media conversion for stream: ' + rtms_stream_id);
    await convertMeetingMedia(rtms_stream_id); // Old method (gap-filled, converts individually)
    console.log('Starting audio-video multiplexing for stream: ' + rtms_stream_id);
    await muxFirstAudioVideo(rtms_stream_id); // Mux the old conversions

    // Generate meeting summary using OpenRouter
    (async () => {
      const safeStreamID = sanitizeFileName(rtms_stream_id);
      console.log('Starting summary generation for stream: ' + rtms_stream_id);
      try {
        const promptTemplate = fs.readFileSync('summary_prompt.md', 'utf-8');
        const eventsLog = fs.existsSync(`recordings/${safeStreamID}/events.log`) ? fs.readFileSync(`recordings/${safeStreamID}/events.log`, 'utf-8') : '';
        const transcriptVtt = fs.existsSync(`recordings/${safeStreamID}/transcript.vtt`) ? fs.readFileSync(`recordings/${safeStreamID}/transcript.vtt`, 'utf-8') : '';

        // Read screen share images and convert to base64
        const processedDir = path.join('recordings', safeStreamID, 'processed', 'jpg');
        let imageBase64Array = [];
        if (fs.existsSync(processedDir)) {
          const imageFiles = fs.readdirSync(processedDir).filter(file => file.endsWith('.jpg'));
          console.log(`Found ${imageFiles.length} screen share images`);
          for (const imageFile of imageFiles) {
            try {
              const imagePath = path.join(processedDir, imageFile);
              const imageBuffer = fs.readFileSync(imagePath);
              const base64Data = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
              imageBase64Array.push(base64Data);
            } catch (err) {
              console.error(`Error reading image ${imageFile}:`, err.message);
            }
          }
        } else {
          console.log('No screen share images directory found');
        }

        const todayDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const filledPrompt = promptTemplate
          .replace(/\{\{raw_transcript\}\}/g, transcriptVtt)
          .replace(/\{\{meeting_events\}\}/g, eventsLog)
          .replace(/\{\{meeting_uuid\}\}/g, meeting_uuid)
          .replace(/\{\{stream_id\}\}/g, rtms_stream_id)
          .replace(/\{\{TODAYDATE\}\}/g, todayDate);

        const summary = await aiFunctions.chat(filledPrompt, undefined, imageBase64Array);
        fs.mkdirSync('meeting_summary', { recursive: true });
        fs.writeFileSync(`meeting_summary/${safeStreamID}.md`, summary);
        console.log(`✅ Summary generated and saved for stream ${rtms_stream_id} at meeting_summary/${safeStreamID}.md`);

        // Generate PDF from the unique screen share images
        console.log('Generating PDF from screen share images for stream: ' + rtms_stream_id);
        await generatePDFAndText(rtms_stream_id);
      } catch (error) {
        console.error('❌ Error generating summary:', error.message);
      }
    })();
  }
});

// Function to generate a signature for authentication
function generateSignature(CLIENT_ID, meetingUuid, streamId, CLIENT_SECRET) {
  console.log('Generating signature with parameters:');
  console.log('meetingUuid:', meetingUuid);
  console.log('streamId:', streamId);
  console.log('CLIENT_ID:', CLIENT_ID);

  // Create a message string and generate an HMAC SHA256 signature
  const message = `${CLIENT_ID},${meetingUuid},${streamId}`;
  const signature = crypto.createHmac('sha256', CLIENT_SECRET).update(message).digest('hex');
  console.log('Generated signature:', signature);
  return signature;
}

// Function to connect to the signaling WebSocket server
function connectToSignalingWebSocket(meetingUuid, streamId, serverUrl) {
  console.log(`Connecting to signaling WebSocket for stream ${streamId}`);
  console.log('Stream ID:', streamId);
  console.log('Server URL:', serverUrl);

  const safeStreamId = sanitizeFileName(streamId);
  console.log('Sanitized Meeting UUID:', safeStreamId);

  const ws = new WebSocket(serverUrl);
  console.log('WebSocket created successfully');

  // Store connection for cleanup later
  if (!activeConnections.has(streamId)) {
    activeConnections.set(streamId, {});
  }
  activeConnections.get(streamId).signaling = ws;
  const streamStartTime = Date.now();
  activeConnections.get(streamId).startTime = streamStartTime;
  activeConnections.get(streamId).meetingUuid = meetingUuid;
  activeConnections.get(streamId).sanitizedMeetingUuid = sanitizeFileName(meetingUuid);
  console.log('Signaling connection stored for cleanup');

  // Set the transcript start timestamp for this stream
  resetTranscriptForStream(streamId); // Clear any previous data for this stream
  setStreamStartTimestamp(streamId, streamStartTime);
  console.log(`⏱️ Set transcript start time for stream ${streamId}: ${streamStartTime} (${new Date(streamStartTime).toISOString()})`);


  // Function to format timestamp to VTT format (HH:MM:SS.mmm)
  function formatVTTTime(ms) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = ms % 1000;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
  }

  // Event type map for verbose names
  const eventTypeNames = {
    2: 'active_speaker_changed',
    3: 'participant_joined',
    4: 'participant_left'
  };

  ws.on('open', () => {
    console.log(`Signaling WebSocket connection opened for stream ${streamId}`);
    const signature = generateSignature(
      CLIENT_ID,
      meetingUuid,
      streamId,
      CLIENT_SECRET
    );

    // Send handshake message to the signaling server
    const handshake = {
      msg_type: 1, // SIGNALING_HAND_SHAKE_REQ
      protocol_version: 1,
      meeting_uuid: meetingUuid,
      rtms_stream_id: streamId,
      sequence: Math.floor(Math.random() * 1e9),
      signature,
    };
    ws.send(JSON.stringify(handshake));
    console.log('Sent handshake to signaling server');
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    console.log('Signaling Message:', JSON.stringify(msg, null, 2));

    // Handle successful handshake response
    if (msg.msg_type === 2 && msg.status_code === 0) { // SIGNALING_HAND_SHAKE_RESP
      const mediaUrl = msg.media_server?.server_urls?.all;
      if (mediaUrl) {
        // Connect to the media WebSocket server using the media URL
        connectToMediaWebSocket(mediaUrl, meetingUuid, safeStreamId, streamId, ws);
      }

      //subscribe to events 
      const payload = {
        msg_type: 5,
        events: [
          { event_type: 2, subscribe: true },
          { event_type: 3, subscribe: true },
          { event_type: 4, subscribe: true }
        ]
      };
      ws.send(JSON.stringify(payload));
      console.log('[SUCCESS] Event Subscription Payload sent:', JSON.stringify(payload, null, 2));
    }

    if (msg.msg_type === 6) {
      console.log("Event Subscription Received.");

      switch (msg.event.event_type) {
        case 1:
          console.log("Event: First packet capture timestamp received.");
          break;
        case 2:
          console.log("Event: Active speaker has changed.");
          const eventData2 = { ...msg.event, event_type: eventTypeNames[msg.event.event_type] };
          fs.mkdirSync(`recordings/${safeStreamId}`, { recursive: true });
          fs.appendFileSync(`recordings/${safeStreamId}/events.log`, JSON.stringify({ timestamp: formatVTTTime(Date.now() - activeConnections.get(streamId).startTime), event: eventData2 }) + '\n');
          break;
        case 3:
          console.log("Event: Participant joined.");
          const eventData3 = { ...msg.event, event_type: eventTypeNames[msg.event.event_type] };
          fs.mkdirSync(`recordings/${safeStreamId}`, { recursive: true });
          fs.appendFileSync(`recordings/${safeStreamId}/events.log`, JSON.stringify({ timestamp: formatVTTTime(Date.now() - activeConnections.get(streamId).startTime), event: eventData3 }) + '\n');
          break;
        case 4:
          console.log("Event: Participant left.");
          const eventData4 = { ...msg.event, event_type: eventTypeNames[msg.event.event_type] };
          fs.mkdirSync(`recordings/${safeStreamId}`, { recursive: true });
          fs.appendFileSync(`recordings/${safeStreamId}/events.log`, JSON.stringify({ timestamp: formatVTTTime(Date.now() - activeConnections.get(streamId).startTime), event: eventData4 }) + '\n');
          break;
        default:
          console.log("Event: Unknown event type.");
      }
    }

    if (msg.msg_type === 8) {
      console.log("Stream Update Received.");

      switch (msg.state) {
        case 0:
          console.log("Stream State: Inactive.");
          break;
        case 1:
          console.log("Stream State: Active.");
          break;
        case 2:
          console.log("Stream State: Interrupted.");
          break;
        case 3:
        case 4:
          console.log("Stream State: Terminating.");
          break;
        default:
          console.log("Stream State: Unknown state.");
      }

      switch (msg.reason) {
        case 1:
          console.log("Stopped because the host triggered it.");
          break;
        case 2:
          console.log("Stopped because the user triggered it.");
          break;
        case 3:
          console.log("Stopped because the user left.");
          break;
        case 4:
          console.log("Stopped because the user was ejected.");
          break;
        case 5:
          console.log("Stopped because the app was disabled by the host.");
          break;
        case 6:
          console.log("Stopped because the meeting ended.");
          break;
        case 7:
          console.log("Stopped because the stream was canceled.");
          break;
        case 8:
          console.log("Stopped because the stream was revoked.");
          break;
        case 9:
          console.log("Stopped because all apps were disabled.");
          break;
        case 10:
          console.log("Stopped due to an internal exception.");
          break;
        case 11:
          console.log("Stopped because the connection timed out.");
          break;
        case 12:
          console.log("Stopped due to meeting connection interruption.");
          break;
        case 13:
          console.log("Stopped because the signaling connection was interrupted.");
          break;
        case 14:
          console.log("Stopped because the data connection was interrupted.");
          break;
        case 15:
          console.log("Stopped because the signaling connection closed abnormally.");
          break;
        case 16:
          console.log("Stopped because the data connection closed abnormally.");
          break;
        case 17:
          console.log("Stopped due to receiving an exit signal.");
          break;
        case 18:
          console.log("Stopped due to an authentication failure.");
          break;
        default:
          console.log("Stopped for an unknown reason.");
      }
    }

    if (msg.msg_type === 9) {
      console.log("Session State Update Received.");

      switch (msg.state) {
        case 2:
          console.log("Session State: Started.");
          break;
        case 3:
          console.log("Session State: Paused.");
          break;
        case 4:
          console.log("Session State: Resumed.");
          break;
        case 5:
          console.log("Session State: Stopped.");
          break;
        default:
          console.log("Session State: Unknown state.");
      }

      switch (msg.reasone) {
        case 1:
          console.log("Stopped because the host triggered it.");
          break;
        case 2:
          console.log("Stopped because the user triggered it.");
          break;
        case 3:
          console.log("Stopped because the user left.");
          break;
        case 4:
          console.log("Stopped because the user was ejected.");
          break;
        case 5:
          console.log("Stopped because the app was disabled by the host.");
          break;
        case 6:
          console.log("Stopped because the meeting ended.");
          break;
        case 7:
          console.log("Stopped because the stream was canceled.");
          break;
        case 8:
          console.log("Stopped because the stream was revoked.");
          break;
        case 9:
          console.log("Stopped because all apps were disabled.");
          break;
        case 10:
          console.log("Stopped due to an internal exception.");
          break;
        case 11:
          console.log("Stopped because the connection timed out.");
          break;
        case 12:
          console.log("Stopped due to meeting connection interruption.");
          break;
        case 13:
          console.log("Stopped because the signaling connection was interrupted.");
          break;
        case 14:
          console.log("Stopped because the data connection was interrupted.");
          break;
        case 15:
          console.log("Stopped because the signaling connection closed abnormally.");
          break;
        case 16:
          console.log("Stopped because the data connection closed abnormally.");
          break;
        case 17:
          console.log("Stopped due to receiving an exit signal.");
          break;
        case 18:
          console.log("Stopped due to an authentication failure.");
          break;
        default:
          console.log("Stopped for an unknown reason.");
      }
    }
    // Respond to keep-alive requests
    if (msg.msg_type === 12) { // KEEP_ALIVE_REQ
      const keepAliveResponse = {
        msg_type: 13, // KEEP_ALIVE_RESP
        timestamp: msg.timestamp,
      };
      console.log('Responding to Signaling KEEP_ALIVE_REQ:', keepAliveResponse);
      ws.send(JSON.stringify(keepAliveResponse));
    }
  });

  ws.on('error', (err) => {
    console.error('Signaling socket error:', err);
  });

  ws.on('close', () => {
    console.log('Signaling socket closed');
    if (activeConnections.has(streamId)) {
      delete activeConnections.get(streamId).signaling;
    }
  });
}

// Function to connect to the media WebSocket server
function connectToMediaWebSocket(mediaUrl, meetingUuid, safestreamId, streamId, signalingSocket) {
  console.log(`Connecting to media WebSocket at ${mediaUrl}`);

  const mediaWs = new WebSocket(mediaUrl, { rejectUnauthorized: false });

  // Store connection for cleanup later
  if (activeConnections.has(streamId)) {
    activeConnections.get(streamId).media = mediaWs;
  }



  mediaWs.on('open', () => {
    const signature = generateSignature(
      CLIENT_ID,
      meetingUuid,
      streamId,
      CLIENT_SECRET
    );
    const handshake = {
      msg_type: 3, // DATA_HAND_SHAKE_REQ
      protocol_version: 1,
      meeting_uuid: meetingUuid,
      rtms_stream_id: streamId,
      signature,
      media_type: 32, // AUDIO+VIDEO+TRANSCRIPT
      payload_encryption: false,
      media_params: {
        audio: {
          content_type: 1,
          sample_rate: 1,
          channel: 1,
          codec: 1,
          data_opt: 1,   //AUDIO_MIXED_STREAM = 1,     AUDIO_MULTI_STREAMS = 2,     
          send_rate: 100
        },
        video: {
          codec: 7, //H264
          resolution: 2,
          fps: 25
        },
        deskshare: {
          codec: 5, //JPG,
          resolution: 2, //720p
          fps: 1
        },
        chat: {
          content_type: 5, //TEXT
        },
        transcript: {
          content_type: 5 //TEXT
        }
      }
    };
    mediaWs.send(JSON.stringify(handshake));
  });

  mediaWs.on('message', (data) => {
    try {
      // Try to parse as JSON first
      const msg = JSON.parse(data.toString());
      //console.log('Media JSON Message:', JSON.stringify(msg, null, 2));

      // Handle successful media handshake
      if (msg.msg_type === 4 && msg.status_code === 0) { // DATA_HAND_SHAKE_RESP
        signalingSocket.send(
          JSON.stringify({
            msg_type: 7, // CLIENT_READY_ACK
            rtms_stream_id: streamId,
          })
        );
        console.log('Media handshake successful, sent start streaming request');
      }

      // Respond to keep-alive requests
      if (msg.msg_type === 12) { // KEEP_ALIVE_REQ
        mediaWs.send(
          JSON.stringify({
            msg_type: 13, // KEEP_ALIVE_RESP
            timestamp: msg.timestamp,
          })
        );
        console.log('Responded to Media KEEP_ALIVE_REQ');
      }

      // Handle audio data
      if (msg.msg_type === 14 && msg.content && msg.content.data) {

        let { user_id, user_name, data: audioData, timestamp } = msg.content;
        let buffer = Buffer.from(audioData, 'base64');
        //console.log(`Processing audio data for user ${user_name} (ID: ${user_id}), buffer size: ${buffer.length} bytes`);
        saveRawAudioAdvance(buffer, streamId, user_id, Date.now()); // Primary method

      }
      // Handle video data
      if (msg.msg_type === 15 && msg.content && msg.content.data) {
        let epochMilliseconds = Date.now();
        let { user_id, user_name, data: videoData, timestamp } = msg.content;
        let buffer = Buffer.from(videoData, 'base64');
        //console.log(`Processing video data for user ${user_name} (ID: ${user_id}), buffer size: ${buffer.length} bytes`);
        saveRawVideoAdvance(buffer, user_name, timestamp, streamId); // Primary method
      }
      // Handle sharescreen data
      if (msg.msg_type === 16 && msg.content && msg.content.data) {
        let epochMilliseconds = Date.now();
        let { user_id, user_name, data: imgData, timestamp } = msg.content;
        // Call handleShareData to process and save unique screen share images
        handleShareData(imgData, user_id, Date.now(), streamId).catch(err => console.error('Error handling share data:', err));
      }
      // Handle transcript data
      if (msg.msg_type === 17 && msg.content && msg.content.data) {
        let { user_id, user_name, data, timestamp } = msg.content;
        //console.log(`Processing transcript: "${data}" from user ${user_name} (ID: ${user_id})`);
        // Write transcript to VTT file
        writeTranscriptToVtt(user_name, timestamp / 1000, data, safestreamId);

        // Broadcast transcript to WebSocket clients immediately
        broadcastToWebSocketClients({
          type: 'transcript',
          user: user_name,
          text: data,
          timestamp: timestamp / 1000
        }, streamId);

        // Schedule AI processing (cached, 15-second intervals)
        scheduleAIProcessing(streamId, meetingUuid);
      }

      // Handle chat data
      if (msg.msg_type === 18 && msg.content && msg.content.data) {
        let { user_id, user_name, data, timestamp } = msg.content;
        console.log(`Chat message from ${user_name} (ID: ${user_id}): "${data}"`);
      }
    } catch (err) {
      console.error('Error processing media message:', err);
    }
  });

  mediaWs.on('error', (err) => {
    console.error('Media socket error:', err);
  });

  mediaWs.on('close', () => {
    console.log('Media socket closed');
    if (activeConnections.has(streamId)) {
      delete activeConnections.get(streamId).media;
    }
  });
}

// GET / - Serve the search page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'search.html'));
});

// GET /search - Serve the search page
app.get('/search', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'search.html'));
});

// GET /api/config - Return configuration for client
app.get('/api/config', (req, res) => {
  const meetingUuid = req.query.meeting || 'global';

  // List available meetings (those with transcript.vtt files)
  const availableMeetings = [];
  try {
    const recordingsDir = 'recordings';
    if (fs.existsSync(recordingsDir)) {
      const dirs = fs.readdirSync(recordingsDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      dirs.forEach(dir => {
        const transcriptPath = path.join(recordingsDir, dir, 'transcript.vtt');
        if (fs.existsSync(transcriptPath)) {
          availableMeetings.push(dir);
        }
      });
    }
  } catch (err) {
    console.error('Error listing available meetings:', err);
  }

  res.json({
    websocketUrl: process.env.WEBSOCKET_URL || 'your.ngrok.url',
    meetingUuid: meetingUuid,
    availableMeetings: availableMeetings
  });
});

// GET /api/live-stream - Check if a meeting is currently live and return its stream ID
app.get('/api/live-stream', (req, res) => {
  const { meetingUuid } = req.query;
  console.log('Meeting UUID:', meetingUuid);
  if (!meetingUuid) {
    return res.status(400).json({ error: 'Meeting UUID is required' });
  }

  console.log(`Checking for live stream for meeting UUID: ${meetingUuid}`);
  console.log('Active connections:', Array.from(activeConnections.entries()).map(([k, v]) => ({
    streamId: k,
    meetingUuid: v.meetingUuid,
    sanitizedStreamId: sanitizeFileName(k)
  })));

  let foundStreamId = null;

  // Iterate through active connections to find matching meeting UUID or Stream ID
  for (const [streamId, data] of activeConnections.entries()) {
    // Check exact meeting UUID match
    if (data.meetingUuid === meetingUuid) {
      foundStreamId = streamId;
      break;
    }
    // Check if sanitized meeting UUID matches (in case frontend sends sanitized version)
    if (data.meetingUuid && sanitizeFileName(data.meetingUuid) === meetingUuid) {
      foundStreamId = streamId;
      break;
    }
    // Check if the provided UUID is actually the stream ID (or sanitized stream ID)
    // This handles the fallback case where frontend sends a stream ID from availableMeetings
    if (streamId === meetingUuid || sanitizeFileName(streamId) === meetingUuid) {
      foundStreamId = streamId;
      break;
    }
  }

  if (foundStreamId) {
    console.log(`Found active stream ${foundStreamId} for meeting/stream ${meetingUuid}`);
    res.json({ streamId: foundStreamId });
  } else {
    console.log(`No active stream found for meeting ${meetingUuid}`);
    res.status(404).json({ streamId: null });
  }
});


// POST /api/meeting-query - Handle queries about current meeting
app.post('/api/meeting-query', async (req, res) => {
  try {
    const { meetingUuid, query } = req.body;
    console.log('Meeting query requested: meetingUuid=' + meetingUuid + ', query=' + query);

    if (!meetingUuid || !query) {
      return res.status(400).json({ error: 'Meeting UUID and query are required' });
    }

    const safeMeetingUuid = sanitizeFileName(meetingUuid);
    const vttPath = `recordings/${safeMeetingUuid}/transcript.vtt`;

    if (!fs.existsSync(vttPath)) {
      return res.status(404).json({ error: 'Meeting transcript not found' });
    }

    const transcript = fs.readFileSync(vttPath, 'utf-8');
    const answer = await aiFunctions.queryCurrentMeeting(transcript, query);

    res.json({ answer });
  } catch (error) {
    console.error('Meeting query error:', error);
    res.status(500).json({ error: 'Failed to process meeting query' });
  }
});



// POST /search - Handle query
app.post('/search', async (req, res) => {
  console.log('Search endpoint called with request body:', JSON.stringify(req.body, null, 2));
  const { query } = req.body;
  console.log('Extracted query:', query);
  if (!query) {
    console.log('Query is missing, sending 400 response');
    return res.status(400).send('Query is required');
  }

  try {
    console.log('Reading query prompt from file');
    // Read query prompt
    const queryPrompt = fs.readFileSync('query_prompt.md', 'utf-8');
    console.log('Query prompt loaded, length:', queryPrompt.length);

    // Read all .md files from meeting_summary
    let meetingSummaries = '';
    if (fs.existsSync('meeting_summary')) {
      console.log('Meeting summary directory exists, reading files');
      const files = fs.readdirSync('meeting_summary').filter(file => file.endsWith('.md'));
      console.log(`Found ${files.length} summary files`);
      for (const file of files) {
        console.log('Reading summary file:', file);
        const content = fs.readFileSync(`meeting_summary/${file}`, 'utf-8');
        meetingSummaries += `\n--- ${file} ---\n${content}\n`;
      }
      console.log('Total meeting summaries length:', meetingSummaries.length);
    } else {
      console.log('Meeting summary directory does not exist');
    }

    console.log('Replacing placeholders in prompt');
    // Replace placeholders
    const filledPrompt = queryPrompt
      .replace(/\{\{meeting_summaries\}\}/g, meetingSummaries)
      .replace(/\{\{query\}\}/g, query);
    console.log('Filled prompt length:', filledPrompt.length);

    console.log('Calling LLM with query');
    // Call OpenRouter
    const answer = await aiFunctions.chatFast(filledPrompt);
    console.log('Received answer from OpenRouter, length:', answer.length);

    console.log('Sending response to client');
    // Return the answer
    res.send(answer);
    //res.send('<pre>' + answer.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>') + '</pre>');
  } catch (error) {
    console.error('Error in search:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).send('Internal server error: ' + error.message);
  }
});

// GET /meeting-summary-files - Return list of .md files in meeting_summary
app.get('/meeting-summary-files', (req, res) => {
  try {
    const summaryDir = 'meeting_summary';
    if (fs.existsSync(summaryDir)) {
      const files = fs.readdirSync(summaryDir).filter(file => file.endsWith('.md'));
      res.json(files);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('Error listing summary files:', error.message);
    res.status(500).send('Internal server error');
  }
});

// GET /meeting-summary/:fileName - Serve the content of a specific summary file
app.get('/meeting-summary/:fileName', (req, res) => {
  const { fileName } = req.params;
  const safeFileName = path.basename(fileName);
  try {
    const filePath = path.join('meeting_summary', safeFileName);
    if (fs.existsSync(filePath) && path.extname(filePath) === '.md') {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.send(content);
    } else {
      res.status(404).send('Summary not found');
    }
  } catch (error) {
    console.error('Error reading summary file:', error.message);
    res.status(500).send('Internal server error');
  }
});

// GET /meeting-pdf/:meetingUuid - Serve PDF file for a specific meeting
app.get('/meeting-pdf/:meetingUuid', (req, res) => {
  const meetingUuid = decodeURIComponent(req.params.meetingUuid);
  const safeMeetingUuid = sanitizeFileName(meetingUuid);
  const pdfPath = path.join('recordings', safeMeetingUuid, 'processed', 'approved.pdf');

  try {
    if (fs.existsSync(pdfPath)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${safeMeetingUuid}_screenshare.pdf"`);
      const fileStream = fs.createReadStream(pdfPath);
      fileStream.pipe(res);
    } else {
      res.status(404).send('PDF not found for this meeting');
    }
  } catch (error) {
    console.error('Error serving PDF:', error.message);
    res.status(500).send('Error serving PDF');
  }
});

// Utility function to extract topic from summary content
function extractTopicFromSummary(content) {
  const match = content.match(/<TOPIC>([^<]+)<\/TOPIC>/);
  return match ? match[1].trim() : null;
}

// Utility function to extract meeting UUID from summary content
function extractUuidFromSummary(content) {
  const match = content.match(/<MEETING_UUID>([^<]+)<\/MEETING_UUID>/);
  return match ? match[1].trim() : null;
}

// GET /meeting-topics - Return mapping of topics to UUIDs for all meetings
app.get('/meeting-topics', (req, res) => {
  try {
    const meetingsDir = 'meeting_summary';
    const topicMap = {};

    if (fs.existsSync(meetingsDir)) {
      const files = fs.readdirSync(meetingsDir).filter(file => file.endsWith('.md'));
      files.forEach(file => {
        try {
          // Always use FILENAME-based UUID for mapping (not content UUID)
          // This matches what frontend extracts from file.replace('.md', '')
          const filenameUuid = file.replace('.md', '');
          const content = fs.readFileSync(path.join(meetingsDir, file), 'utf-8');
          const topic = extractTopicFromSummary(content);
          if (topic && filenameUuid) {
            topicMap[topic] = filenameUuid; // topic -> filename UUID (sanitized)
          }
        } catch (err) {
          console.error(`Error reading ${file}:`, err.message);
        }
      });
    }

    res.json(topicMap); // Maps topic -> filename UUID (with __)
  } catch (error) {
    console.error('Error loading meeting topics:', error.message);
    res.status(500).send('Error loading meeting topics');
  }
});

// WebSocket broadcasting function for real-time updates
function broadcastToWebSocketClients(message, streamId = null) {
  // Send message to all connected client WebSockets
  // For now, we'll implement this when we add the client WebSocket server
  console.log('Broadcasting message:', message);

  // If streamId specified, only broadcast to clients connected to that meeting
  if (streamId && clientWebSocketConnections.has(streamId)) {
    const clients = clientWebSocketConnections.get(streamId);
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(JSON.stringify(message));
        } catch (err) {
          console.error('Error sending to client:', err);
        }
      }
    });
  } else {
    // Broadcast to all clients (global broadcast)
    clientWebSocketConnections.forEach((clients, uuid) => {
      clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(JSON.stringify(message));
          } catch (err) {
            console.error('Error sending to client:', err);
          }
        }
      });
    });
  }
}

// AI Processing scheduler with caching (configurable intervals)
function scheduleAIProcessing(streamId, meetingUuid) {
  const now = Date.now();
  const cacheKey = streamId;
  const cache = aiCache.get(cacheKey) || {};

  const safeStreamId = sanitizeFileName(streamId);

  // Get configurable interval from environment (default: 15000ms = 15 seconds)
  const aiProcessingInterval = parseInt(process.env.AI_PROCESSING_INTERVAL_MS) || 30000;

  // Get configurable stagger delay from environment (default: 500ms = 0.5 seconds)
  const aiFunctionStagger = parseInt(process.env.AI_FUNCTION_STAGGER_MS) || 5000;

  // Only process if configured interval has passed since last update
  if (!cache.lastUpdated || (now - cache.lastUpdated) > aiProcessingInterval) {
    console.log('🧠 Starting AI processing for stream:', streamId);

    // Read full VTT transcript for AI context
    const vttPath = `recordings/${safeStreamId}/transcript.vtt`;
    if (!fs.existsSync(vttPath)) {
      console.log('VTT transcript not found, skipping AI processing');
      return;
    }

    const currentVTT = fs.readFileSync(vttPath, 'utf-8');

    // Read events log (but NOT screen share images for real-time processing)
    const eventsLog = fs.existsSync(`recordings/${safeStreamId}/events.log`) ? fs.readFileSync(`recordings/${safeStreamId}/events.log`, 'utf-8') : '';

    // Note: Screen share images are NOT processed in real-time loop to avoid expensive image API calls
    // Images are only processed during final summary generation when stream ends

    // Process AI functions with staggered timing to avoid clustering
    (async () => {
      try {
        console.log('🤖 Starting staggered AI processing...');

        // Start all functions but with configurable delays between them
        const dialogPromise = aiFunctions.generateDialogSuggestions(currentVTT);

        // Wait for stagger delay before starting sentiment analysis
        await new Promise(resolve => setTimeout(resolve, aiFunctionStagger));
        const sentimentPromise = aiFunctions.analyzeSentiment(currentVTT);

        // Wait another stagger delay before starting summary generation (without images)
        await new Promise(resolve => setTimeout(resolve, aiFunctionStagger));
        const summaryPromise = aiFunctions.generateRealTimeSummary(currentVTT, eventsLog, [], streamId, meetingUuid);

        // Wait for all to complete
        const [dialogSuggestions, sentimentAnalysis, realTimeSummary] = await Promise.all([
          dialogPromise, sentimentPromise, summaryPromise
        ]);

        // Update cache
        cache.dialog = dialogSuggestions;
        cache.sentiment = sentimentAnalysis;
        cache.summary = realTimeSummary;
        cache.lastUpdated = now;
        aiCache.set(cacheKey, cache);

        console.log('✅ AI processing complete, broadcasting results');

        // Broadcast AI results to clients
        broadcastToWebSocketClients({
          type: 'ai_dialog',
          suggestions: dialogSuggestions
        }, streamId);

        broadcastToWebSocketClients({
          type: 'sentiment',
          analysis: sentimentAnalysis
        }, streamId);

        broadcastToWebSocketClients({
          type: 'meeting_summary',
          summary: realTimeSummary
        }, streamId);

      } catch (err) {
        console.error('❌ AI processing error:', err);
      }
    })();
  } else {
    console.log('⏳ AI cache still fresh, skipping processing');
  }
}

// Start the server and listen on the specified port
(async () => {
  // Initialize AI provider before starting server
  await loadAIProvider();

  const server = app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Webhook endpoint available at http://localhost:${port}${WEBHOOK_PATH}`);
  });

  // Initialize WebSocket server for client connections
  const wss = new WebSocketServer({
    server,
    perMessageDeflate: false
  });

  wss.on('connection', (ws, request) => {
    console.log('🖥️ Client connected to WebSocket server');

    // Extract meeting UUID and stream ID from query parameters
    const url = new URL(request.url, `ws://localhost:${port}`);
    const meetingUuid = url.searchParams.get('meeting');
    const streamId = url.searchParams.get('streamId');

    console.log(`Client joined meeting: ${meetingUuid || 'global'}, stream: ${streamId || 'none'}`);

    // Store connection by stream ID if provided, otherwise by meeting UUID (legacy/fallback)
    const connectionKey = streamId || meetingUuid || 'global';

    if (!clientWebSocketConnections.has(connectionKey)) {
      clientWebSocketConnections.set(connectionKey, []);
    }
    clientWebSocketConnections.get(connectionKey).push(ws);

    // Set up keep-alive ping/pong
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000); // Ping every 30 seconds

    ws.on('pong', () => {
      // Client responded to ping - connection is healthy
      console.log('🔄 Pong received from client');
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('📨 Received client message:', message);
        // Handle client messages if needed (currently just broadcasting)
      } catch (err) {
        console.error('❌ Error parsing client message:', err);
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`📴 Client disconnected: ${code} ${reason}`);

      // Remove from connection store
      // Remove from connection store
      const connectionKey = streamId || meetingUuid || 'global';
      if (clientWebSocketConnections.has(connectionKey)) {
        const clients = clientWebSocketConnections.get(connectionKey);
        const index = clients.indexOf(ws);
        if (index > -1) {
          clients.splice(index, 1);
          if (clients.length === 0) {
            clientWebSocketConnections.delete(connectionKey);
          }
        }
      }

      clearInterval(pingInterval);
    });

    ws.on('error', (err) => {
      console.error('❌ WebSocket client error:', err);
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Connected to RTMS meeting intelligence server',
      meeting: meetingUuid || 'global'
    }));
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    wss.close(() => {
      server.close(() => {
        process.exit(0);
      });
    });
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully...');
    wss.close(() => {
      server.close(() => {
        process.exit(0);
      });
    });
  });
})();
