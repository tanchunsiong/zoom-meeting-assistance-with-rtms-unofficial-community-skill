# RTMS Meeting Assistant Starter Kit

This starter kit provides a quick way to get started on Zoom RTMS + Zoom Apps, using transcription, summarization, and chat functionality with support for multiple AI providers including OpenRouter (Paid), Gemma, Qwen, and DeepSeek.

### How It Works

1. **Receive Media via Zoom RTMS**: Utilizes Zoom's Real-Time Media Streams (RTMS) to receive raw transcript, video, and audio streams directly from Zoom meetings during active sessions
2. **Summary Processing via LLM**: Leverages the configured Large Language Model (LLM) to analyze transcripts and generate comprehensive meeting summaries with structured outputs including key decisions, action items, and entity detection
3. **Search via LLM**: Natural language querying across all meeting summaries using the LLM, enabling users to ask questions in plain English and receive contextual answers with streamid references


### File Structure & Purpose

```
project/
├── .env                        # API keys & config
├── summary_prompt.md           # LLM instructions for summarization
├── query_prompt.md             # LLM instructions for search queries
├── black_frame.h264            # Black frame template for video gap filling
├── sps_pps_keyframe.h264       # H.264 video headers for stream compatibility
├── index.js                    # Main RTMS application server & recording logic
├── muxFirstAudioVideo.js       # Initial audio/video muxing for combined streams
├── saveRawAudioAdvance.js      # Real-time audio stream saving
├── saveRawVideoAdvance.js      # Real-time video stream saving
├── writeTranscriptToVtt.js     # Real-time transcript writing in multiple formats
├── convertMeetingMedia.js      # FFmpeg conversion utilities
├── chatWithOpenrouter.js       # OpenRouter LLM API integration for chat & summarization
├── chatWithGemma.js            # Google Gemma LLM API integration (free model)
├── chatWithQwen.js             # Alibaba Qwen LLM API integration (free model)
├── chatWithDeepSeek.js         # DeepSeek LLM API integration (free model)
├── saveSharescreen.js          # Real-time screenshare capture, frame deduplication, and PDF generation
├── tool.js                     # Utility functions including filename sanitization
└── static/
    ├── search.html             # Web interface for search/video/summaries
    ├── search.js               # Frontend logic for search interface
    └── d3.v7.min.js            # D3.js library for data visualization and interactive charts
recordings/                     # Generated meeting data storage
    └── {streamId}/          # Per-meeting directory
        ├── transcript.(vtt|srt|txt)  # Real-time transcripts
        ├── event.logs           # Meeting event data (participant join/leave)
        ├── {userId}.raw         # Per-participant raw audio (gaps filled)
        ├── combined.h264        # Combined raw video with SPS/PPS headers
        ├── final_output.mp4     # Final muxed video for playback
        └── processed/           # Sharescreen processing directory
            ├── jpg/             # Individual captured JPEG frames
            ├── screenshare.pdf  # Compiled sharescreen PDF with deduplicated frames
            └── frames.txt       # Timestamp log of when screenshare frames appear in the meeting
meeting_summary/                # LLM-generated meeting summaries
    └── {streamId}.md        # Formatted meeting summary with structured content
```

## Setup Instructions

### AI Provider Configuration

The application supports multiple AI providers. Choose one based on your needs:

#### Option 1: OpenRouter 
For paid AI models with high reliability and XML tagging support:

1. Visit [OpenRouter](https://openrouter.ai/) and sign up for an account.
2. Generate an API key from your OpenRouter dashboard.
3. Configure your `.env` file with OpenRouter settings.

#### Option 2: Free Models (Gemma, Qwen, DeepSeek)
For cost-free AI models (may have rate limits and **no image support**):

- **Gemma**: Google's lightweight model, good for basic tasks
- **Qwen**: Alibaba's model with good multilingual support
- **DeepSeek**: Advanced reasoning capabilities with competitive performance

⚠️ **Important**: Free models have several limitations:
- **No image support**: Features like screenshare analysis and visual meeting summaries will not work
- **Context limits**: Searching through all .md summary files may fail due to token limits
- **Rate limiting**: May return 429 errors when called too frequently during realtime AI analysis

### Environment Configuration

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit the `.env` file and update the values according to your setup:

**Configuration Notes:**
- Use modern LLMs that support XML tagging (like Google Gemini 2.5 Pro) for best results
- `AI_PROCESSING_INTERVAL_MS`: Controls how frequently AI analyzes meeting data (default: 30 seconds)
- `AI_FUNCTION_STAGGER_MS`: Prevents API clustering by staggering AI function calls (default: 5000ms)
- Free models (gemma, qwen, deepseek) may have rate limits but don't require API keys
- Keep your API keys secure and never commit them to version control

### Zoom Marketplace Configuration

To integrate this application with Zoom, add it to the Zoom Marketplace or configure your Zoom app as follows:

- Set the Zoom app URL to `{domain}/search`, replacing `{domain}` with your actual domain (e.g., `https://yourdomain.com/search`).
- Set the webhook URL to `{domain}/webhook` (as configured by `WEBHOOK_PATH="/webhook"` in your `.env` file) to match the setup on [marketplace.zoom.us](https://marketplace.zoom.us).

Ensure your application is accessible at these endpoints to handle Zoom requests.

## Features

### Real-Time Recording
During active meetings, the application saves transcript, video, audio, screenshare, and event data to disk in real time for immediate access and processing.

- **Transcripts**: Saved as VTT, SRT, and TXT files in the `recordings/{streamId}` folder with timestamped entries.
- **Audio**: Raw PCM data is stored per participant in `.raw` files within `recordings/{streamId}/{userId}.raw`, with automatic gap filling for silent periods.
- **Video**: Raw H.264 video is combined into a single file `recordings/{streamId}/combined.h264`, with SPS/PPS headers for playback compatibility and gap filling using black frames.
- **Screenshare**: Captured as JPEG images in `recordings/{streamId}/processed/jpg/` with deduplication to avoid redundant frames, and compiled into PDF format for easy viewing and analysis.
- **Events**: Meeting participant activities (join/leave events) logged in `recordings/{streamId}/events.log` with timestamps for attendance tracking and meeting analytics.


### Real-Time AI Processing
During active meetings, the application provides live AI analysis to enhance meeting facilitation and participant engagement. The LLM continuously processes incoming transcripts to generate:

- **Dialog Suggestions**: Strategic conversation directions and facilitation tips to guide meeting discussions effectively
- **Sentiment Analysis**: Real-time assessment of participant sentiment and emotional indicators from speech patterns
- **Meeting Summaries**: Live summarization of ongoing discussions with key points and decisions as they emerge

These insights are broadcast via WebSocket to connected Zoom Apps, providing facilitators and participants with immediate AI-powered assistance during the meeting.

### Post-Meeting Processing
After meetings conclude, comprehensive AI-powered processing generates detailed meeting summaries and finalizes media files. The LLM analyzes transcripts, screenshare images, and participant event logs to create structured summaries with key decisions, action items, and entity detection. These summaries are saved as formatted Markdown files in `meeting_summary/{streamId}.md` for easy access and search.

Additionally, raw audio and video streams are combined into a final muxed video file (`recordings/{streamId}/final_output.mp4`) for archival and playback, ensuring all meeting content is properly processed and accessible.

### Data Storage and Reuse
All meeting data is stored in a structured format within the `recordings/{streamId}/` directory, enabling users to leverage this rich dataset for custom AI training and analysis:

- **Transcripts**: Available in multiple formats (VTT, SRT, TXT) for natural language processing tasks
- **Audio**: Raw PCM data per participant in `.raw` files, suitable for speech recognition training
- **Video**: Raw H.264 streams and final muxed MP4 files for computer vision applications
- **Sharescreen Media**: Captured screenshots  (in `/processed`) saved as JPEG files, along with generated PDF compilations, perfect for document analysis and visual content training
- **Event Logs**: Structured logs of meeting events (participant join/leave) that can be used for analyzing meeting participation patterns

This comprehensive media library allows developers to fine-tune AI models on your own meeting data, improving accuracy for industry-specific terminology, speaker recognition, and content analysis.

## Customization

The application supports extensive customization of AI behavior through multiple configuration options:

### AI Processing Configuration
- `AI_PROCESSING_INTERVAL_MS`: Controls how frequently AI analyzes meeting data during active sessions (default: 30000ms = 30 seconds)
- `AI_FUNCTION_STAGGER_MS`: Prevents API clustering by adding delays between AI function calls (default: 5000ms = 5 seconds)

### Prompt File Customization
The application supports customization of AI behavior through prompt files:

- `summary_prompt.md`: Defines how meeting summaries are generated, including structured output for key decisions, action items, and entity detection. Users can modify this file to adjust the summarization logic without altering code.
- `query_prompt.md`: Specifies how the AI responds to user queries about meeting data, including XML tagging for meeting references. This allows users to customize query responses and output formatting.
- `query_prompt_current_meeting.md`: Controls AI analysis of current ongoing meetings, allowing users to query real-time transcript data for insights about active conversations and participant activity.
- `query_prompt_dialog_suggestions.md`: Enables the AI to generate strategic conversation directions for meeting facilitation, providing 4 actionable suggestions for guiding discussions like RPG quest options.
- `query_prompt_sentiment_analysis.md`: Performs detailed sentiment analysis of all meeting participants, scoring each user's positive, neutral, and negative sentiment indicators from their speech patterns.

These configuration options and prompt files enable easy customization of AI behavior for different industries or user preferences without requiring code changes or recompilation.

## Frontend Zoom Apps

The application provides a comprehensive web interface accessible at `/search` (served by `static/search.html` and powered by `static/search.js`) for interacting with meeting data:

- **Search and Playback**: Select meetings by stream id to search and display meeting summaries (from `meeting_summary/{streamId}.md` files) alongside synchronized video playback (from `recordings/{streamId}/final_output.mp4`), with clickable transcript lines that jump to corresponding video timestamps.
- **View All Summaries**: Browse and display all formatted meeting summaries from `meeting_summary/{streamId}.md` files stored in the system.
- **Real-time Dashboard**: Use natural language to interact with current meetings by processing cumulative transcript in `recordings/{streamId}/transcript.vtt` file to generate AI dialog suggestions, sentiment analysis and real-time summarization.


## API & Integration

### REST API Endpoints

The application provides several REST API endpoints designed for Zoom Apps integration:

- `GET /search` - Serves the main web interface for meeting search and playback
- `GET /api/config` - Returns configuration data including WebSocket URL and list of available meetings for client initialization
- `POST /api/meeting-query` - Handles AI-powered queries about current meeting transcripts using natural language
- `POST /search` - Processes queries across historical meeting summaries and returns structured responses with stream ID references
- `GET /meeting-summary-files` - Returns a list of all available meeting summary files
- `GET /meeting-summary/:fileName` - Serves the content of a specific meeting summary file
- `GET /meeting-pdf/:streamId` - Serves compiled screen share PDF files for specific meetings
- `GET /meeting-topics` - Provides a mapping of meeting topics to their corresponding stream IDs

### WebSocket Server

The server includes a WebSocket implementation specifically designed for Zoom Apps to establish real-time connections:

- Enables Zoom Apps to receive live transcript updates as they occur during meetings
- Broadcasts real-time AI processing results including sentiment analysis, dialog suggestions, and meeting summaries
- Provides connection status monitoring for reliable real-time data delivery
- Supports multiple simultaneous Zoom Apps connections per meeting for collaborative features

### Security Headers

Comprehensive security headers are implemented using Helmet.js middleware to meet Zoom Apps requirements:

- **Content Security Policy (CSP)** - Prevents XSS attacks and restricts resource loading to approved sources
- **Strict-Transport-Security (HSTS)** - Enforces HTTPS connections and prevents protocol downgrade attacks
- **X-Content-Type-Options: nosniff** - Prevents MIME type sniffing vulnerabilities
- **Referrer-Policy** - Controls referrer information sent with requests
- **Security Middleware** - Additional protections via Helmet.js against common web vulnerabilities

### Zoom Apps Integration Requirements

**Important**: When deploying this application for use within Zoom meeting client's app tab, developers must ensure compliance with Zoom's current security and integration requirements. Always refer to the latest [Zoom Apps documentation](https://marketplace.zoom.us/docs/) for:

- Updated security header requirements and CSP policies
- WebSocket connection protocols and authentication methods
- API endpoint specifications and rate limiting guidelines
- Content embedding and iframe restrictions within Zoom clients

Zoom regularly updates security policies, so please verify your implementation against the most current documentation before deploying to production.
