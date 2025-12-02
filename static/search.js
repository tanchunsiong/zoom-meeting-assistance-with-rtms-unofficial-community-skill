document.addEventListener('DOMContentLoaded', () => {
  // Theme Toggle Logic
  const themeToggleBtn = document.getElementById('theme-toggle');
  const htmlElement = document.documentElement;
  const iconSpan = themeToggleBtn.querySelector('span');

  // Check local storage for saved theme
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) {
    htmlElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
  } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    // Auto-detect system preference
    htmlElement.setAttribute('data-theme', 'dark');
    updateThemeIcon('dark');
  }

  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = htmlElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    htmlElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
  });

  function updateThemeIcon(theme) {
    if (theme === 'dark') {
      iconSpan.textContent = '☀️';
      themeToggleBtn.innerHTML = '<span>☀️</span> Light Mode';
    } else {
      iconSpan.textContent = '🌙';
      themeToggleBtn.innerHTML = '<span>🌙</span> Dark Mode';
    }
  }

  // Tab switching functionality
  const tabButtons = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      // Remove active class from all buttons and content
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));

      // Add active class to clicked button and corresponding content
      button.classList.add('active');
      const tabId = button.getAttribute('data-tab');
      document.getElementById(tabId).classList.add('active');
    });
  });

  // Load topics on page load
  const loadMeetingTopics = async () => {
    try {
      const response = await fetch('/meeting-topics');
      if (response.ok) {
        topicToUuidMap = await response.json();
        console.log('Loaded topics:', topicToUuidMap);
        return true;
      } else {
        console.error('Failed to load meeting topics');
        topicToUuidMap = {};
        return false;
      }
    } catch (error) {
      console.error('Error loading meeting topics:', error);
      topicToUuidMap = {};
      return false;
    }
  };

  // Search functionality
  const form = document.querySelector('.section form');
  const queryInput = document.getElementById('query-input');
  const results = document.getElementById('results');
  const loadingSpinner = document.getElementById('loading-spinner');
  const playbackContent = document.getElementById('playback-content');
  // Only select suggestion chips in the search tab to avoid triggering search when clicking real-time chips
  const suggestionChips = document.querySelectorAll('#search-playback .suggestion-chip');

  // Handle suggestion chip clicks
  suggestionChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const query = chip.getAttribute('data-query');
      queryInput.value = query;
      // Trigger form submission
      form.dispatchEvent(new Event('submit'));
    });
  });

  // Handle real-time query suggestion chip clicks
  const rtQueryChips = document.querySelectorAll('.rt-query-chip');
  rtQueryChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const query = chip.getAttribute('data-query');
      const rtQueryInput = document.getElementById('rt-query-input');
      const rtQueryButton = document.getElementById('rt-query-button');

      if (rtQueryInput && rtQueryButton) {
        rtQueryInput.value = query;
        // Trigger click on the Ask AI button
        rtQueryButton.click();
      }
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = queryInput.value.trim();
    if (!query) {
      results.textContent = 'Please enter a query.';
      return;
    }

    // Show loading state
    loadingSpinner.style.display = 'flex';
    playbackContent.style.display = 'none';
    results.textContent = '';

    try {
      // Simulate a small delay for better UX (optional)
      await new Promise(resolve => setTimeout(resolve, 800));

      const response = await fetch('/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `query=${encodeURIComponent(query)}`
      });

      if (response.ok) {
        const result = await response.text();
        results.innerHTML = `<div style="white-space: pre-wrap; overflow-wrap: break-word; word-break: break-word;">${result}</div>`;

        // Show content and hide loader
        loadingSpinner.style.display = 'none';
        playbackContent.style.display = 'block';

        // Scroll to results
        results.scrollIntoView({ behavior: 'smooth' });

        // Extract stream IDs from the result using regex
        const streamIdRegex = /<stream_id>([^<]+)<\/stream_id>/gi;
        const foundStreamIds = [];
        let match;
        while ((match = streamIdRegex.exec(result)) !== null) {
          foundStreamIds.push(match[1].trim());
        }

        // Populate dropdown with topics if stream IDs found
        if (foundStreamIds.length > 0) {
          // Clear existing options except the first
          while (meetingUuidSelect.children.length > 1) {
            meetingUuidSelect.removeChild(meetingUuidSelect.lastChild);
          }
          foundStreamIds.forEach(streamId => {
            // Find topic for this stream ID (topicToUuidMap maps topic -> stream_id)
            const topic = Object.keys(topicToUuidMap).find(t => topicToUuidMap[t] === streamId) || '';

            // Show topic + short stream ID for identification
            const shortStreamId = streamId.replace(/[/]/g, '').substring(0, 8);
            const displayText = topic ? `${topic} (${shortStreamId}...)` : `Meeting ${shortStreamId}...`;

            const option = document.createElement('option');
            option.value = streamId; // Store stream ID as value
            option.textContent = displayText; // Display topic text
            meetingUuidSelect.appendChild(option);
          });
          // Auto-load first meeting
          meetingUuidSelect.value = foundStreamIds[0];
          loadMeetingContent(foundStreamIds[0]);
        } else {
          console.log('No stream IDs found in response');
        }

      } else {
        results.textContent = 'Error performing search.';
        loadingSpinner.style.display = 'none';
      }
    } catch (error) {
      console.error('Error:', error);
      results.textContent = 'An error occurred.';
      loadingSpinner.style.display = 'none';
    }
  });

  // Video loading
  const meetingUuidSelect = document.getElementById('meeting-uuid-select');
  const videoPlayer = document.getElementById('video-player');
  const transcriptDiv = document.getElementById('transcript-text');
  const vttTrack = document.getElementById('vtt-track');
  const pdfButton = document.getElementById('pdf-button');
  const pdfSection = document.getElementById('pdf-section');
  const pdfIframe = document.getElementById('pdf-iframe');
  const hidePdfBtn = document.getElementById('hide-pdf');

  const summaryButton = document.getElementById('summary-button');
  const summarySection = document.getElementById('summary-section');
  const inlineSummaryContent = document.getElementById('inline-summary-content');
  const hideSummaryBtn = document.getElementById('hide-summary');

  // Global mapping of topics to UUIDs
  let topicToUuidMap = {};

  // Function to parse VTT time string to seconds
  const parseVTTTime = (timeStr) => {
    const [hms, ms] = timeStr.split('.');
    const [h, m, s] = hms.split(':').map(Number);
    return h * 3600 + m * 60 + s + Number(ms) / 1000;
  };

  // Global variables for speaker timeline
  let speakerTimelineData = [];
  let currentTranscriptElements = [];
  let timelineSvg = null;
  let availableVideoMeetings = []; // Store filtered meetings from search results

  // Helper function to format meeting summary from XML-like format to HTML
  const formatMeetingSummary = (summaryText) => {
    if (!summaryText) return '';

    // Parse XML-like tags and convert to HTML
    let formatted = summaryText;

    // Extract and format each section
    const sections = [
      { tag: 'TOPIC', header: 'Topic', level: 'h2' },
      { tag: 'DATE', header: 'Date', level: 'h3' },
      { tag: 'MEETING_UUID', header: 'Meeting UUID', level: 'h3' },
      { tag: 'STREAM_ID', header: 'Stream ID', level: 'h3' },
      { tag: 'SUMMARY', header: 'Summary', level: 'h3' },
      { tag: 'KEY_DECISIONS', header: 'Key Decisions', level: 'h3' },
      { tag: 'ACTION_ITEMS', header: 'Action Items', level: 'h3' },
      { tag: 'RISKS_OR_BLOCKERS', header: 'Risks or Blockers', level: 'h3' },
      { tag: 'SCREEN_SHARE', header: 'Screen Share Analysis', level: 'h3' },
      { tag: 'ENTITY_DETECTION', header: 'Entity Detection', level: 'h3' }
    ];

    let htmlOutput = '';

    sections.forEach(({ tag, header, level }) => {
      const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
      const match = summaryText.match(regex);

      if (match && match[1].trim()) {
        const content = match[1].trim();
        htmlOutput += `<${level}>${header}</${level}><p>${content}</p>`;
      }
    });

    // If no XML tags found, return original text
    if (!htmlOutput) {
      return `<p>${summaryText}</p>`;
    }

    return htmlOutput;
  };

  // Function to parse speaker name from transcript text
  const parseSpeakerName = (text) => {
    // Look for patterns like "Speaker Name: " or "John Doe: "
    const speakerMatch = text.match(/^([^:]+):\s*/);
    if (speakerMatch) {
      return speakerMatch[1].trim();
    }
    return 'Unknown Speaker';
  };

  // Function to create speaker timeline visualization
  const createSpeakerTimeline = (timelineData, totalDuration) => {
    const container = d3.select('#speaker-timeline');
    container.html(''); // Clear

    const margin = { top: 20, right: 80, bottom: 30, left: 120 };
    const width = container.node().getBoundingClientRect().width - margin.left - margin.right;
    const height = 100 - margin.top - margin.bottom;

    // Create SVG
    timelineSvg = container
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Create scales
    const xScale = d3.scaleLinear()
      .domain([0, totalDuration])
      .range([0, width]);

    const yScale = d3.scaleBand()
      .domain(timelineData.map(d => d.speaker))
      .range([0, height])
      .padding(0.1);

    const colorScale = d3.scaleOrdinal(d3.schemeCategory10);

    // Add axes
    timelineSvg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(xScale)
        .tickFormat(d => {
          const minutes = Math.floor(d / 60);
          const seconds = Math.floor(d % 60);
          return `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }));

    timelineSvg.append('g')
      .call(d3.axisLeft(yScale));

    // Add speaker bars
    timelineSvg.selectAll('.speaker-bar')
      .data(timelineData)
      .enter()
      .append('rect')
      .attr('class', 'speaker-bar')
      .attr('x', d => xScale(d.start))
      .attr('y', d => yScale(d.speaker))
      .attr('width', d => Math.max(2, xScale(d.end) - xScale(d.start)))
      .attr('height', yScale.bandwidth())
      .attr('fill', d => colorScale(d.speaker))
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('click', function (event, d) {
        videoPlayer.currentTime = d.start;
      });

    // Add time indicator line
    const timeIndicator = timelineSvg.append('line')
      .attr('class', 'time-indicator')
      .attr('x1', 0)
      .attr('x2', 0)
      .attr('y1', 0)
      .attr('y2', height)
      .attr('stroke', 'red')
      .attr('stroke-width', 2);

    // Update time indicator position
    const updateTimeIndicator = () => {
      if (timelineSvg && !isNaN(videoPlayer.currentTime)) {
        const xPos = xScale(videoPlayer.currentTime);
        timeIndicator.attr('x1', xPos).attr('x2', xPos);
      }
    };

    // Update on timeupdate
    videoPlayer.addEventListener('timeupdate', updateTimeIndicator);
    return updateTimeIndicator;
  };

  // Function to populate transcript with clickable lines
  const populateTranscript = (text) => {
    transcriptDiv.innerHTML = ''; // Clear
    currentTranscriptElements = []; // Reset for highlighting
    speakerTimelineData = []; // Reset timeline data

    const lines = text.split('\n');
    let currentCue = null;
    let cueText = '';
    let totalDuration = 0;

    lines.forEach(line => {
      if (line.trim() === 'WEBVTT') {
        // Skip header
      } else if (line.includes('-->')) { // time line
        if (currentCue && cueText) {
          const element = createCueElement(currentCue, cueText.trim());
          const speaker = parseSpeakerName(cueText.trim());

          // Track element for highlighting
          currentTranscriptElements.push({
            element: element,
            start: currentCue.start,
            end: currentCue.end,
            text: cueText.trim()
          });

          // Add to timeline data
          speakerTimelineData.push({
            speaker: speaker,
            start: currentCue.start,
            end: currentCue.end,
            text: cueText.trim()
          });

          totalDuration = Math.max(totalDuration, currentCue.end);
          cueText = '';
        }
        const [start, end] = line.split(' --> ');
        currentCue = { start: parseVTTTime(start), end: parseVTTTime(end) };
      } else if (line.trim() === '' && currentCue) {
        if (cueText) {
          const element = createCueElement(currentCue, cueText.trim());
          const speaker = parseSpeakerName(cueText.trim());

          // Track element for highlighting
          currentTranscriptElements.push({
            element: element,
            start: currentCue.start,
            end: currentCue.end,
            text: cueText.trim()
          });

          // Add to timeline data
          speakerTimelineData.push({
            speaker: speaker,
            start: currentCue.start,
            end: currentCue.end,
            text: cueText.trim()
          });

          totalDuration = Math.max(totalDuration, currentCue.end);
          cueText = '';
          currentCue = null;
        }
      } else if (currentCue && line.trim() && !line.includes('-->') && !(!isNaN(line.trim()) && !line.includes(':'))) {
        // Accumulate text lines
        cueText += line.trim() + ' ';
      } else if (currentCue && !isNaN(line.trim()) && line.trim() !== '') {
        // Cue id, skip
      }
    });
    if (currentCue && cueText) {
      const element = createCueElement(currentCue, cueText.trim());
      const speaker = parseSpeakerName(cueText.trim());

      // Track element for highlighting
      currentTranscriptElements.push({
        element: element,
        start: currentCue.start,
        end: currentCue.end,
        text: cueText.trim()
      });

      // Add to timeline data
      speakerTimelineData.push({
        speaker: speaker,
        start: currentCue.start,
        end: currentCue.end,
        text: cueText.trim()
      });

      totalDuration = Math.max(totalDuration, currentCue.end);
    }

    // Create timeline if we have data
    if (speakerTimelineData.length > 0 && totalDuration > 0) {
      timelineSvg = null; // Reset
      createSpeakerTimeline(speakerTimelineData, totalDuration);

      // Add transcript highlighting functionality
      let previousElementIndex = -1;
      const highlightTranscript = () => {
        const currentTime = videoPlayer.currentTime;
        let currentElementIndex = -1;

        // Find which transcript element corresponds to current time
        for (let i = 0; i < currentTranscriptElements.length; i++) {
          const element = currentTranscriptElements[i];
          if (currentTime >= element.start && currentTime <= element.end) {
            currentElementIndex = i;
            break;
          }
        }

        // Update highlighting with bounds checking
        if (previousElementIndex !== -1 && previousElementIndex !== currentElementIndex && previousElementIndex < currentTranscriptElements.length) {
          const prevElement = currentTranscriptElements[previousElementIndex];
          if (prevElement && prevElement.element) {
            prevElement.element.classList.remove('active');
          }
        }

        if (currentElementIndex !== -1 && currentElementIndex < currentTranscriptElements.length) {
          const currentElement = currentTranscriptElements[currentElementIndex];
          if (currentElement && currentElement.element) {
            currentElement.element.classList.add('active');

            // Auto-scroll to keep current line in view
            currentElement.element.scrollIntoView({
              behavior: 'smooth',
              block: 'center'
            });
          }
        }

        previousElementIndex = currentElementIndex;
      };

      // Clean up any existing transcript highlighting listeners
      if (videoPlayer._transcriptHighlightListener) {
        videoPlayer.removeEventListener('timeupdate', videoPlayer._transcriptHighlightListener);
      }

      // Set up highlighting
      videoPlayer.addEventListener('timeupdate', highlightTranscript);
      videoPlayer._transcriptHighlightListener = highlightTranscript;

      // Console confirmation that transcript highlighting is set up
      console.log(`🎯 Transcript highlighting ready: ${currentTranscriptElements.length} transcript lines`);
    }
  };

  // Function to create a clickable transcript element with chat bubble styling
  const createCueElement = (cue, text) => {
    // Format the start time for display
    const startTime = new Date(cue.start * 1000).toISOString().substr(11, 8);

    // Extract speaker name if present (format: "Speaker Name: text")
    let speaker = 'Unknown Speaker';
    let message = text.trim();
    const speakerMatch = text.match(/^([^:]+):\s*(.+)$/);
    if (speakerMatch) {
      speaker = speakerMatch[1].trim();
      message = speakerMatch[2].trim();
    }

    // Create chat bubble structure (matching real-time transcript)
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message';

    const metaDiv = document.createElement('div');
    metaDiv.className = 'chat-meta';
    metaDiv.textContent = `[${startTime}] ${speaker}`;

    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'chat-bubble';
    bubbleDiv.textContent = message;

    // Make it clickable to seek video
    messageDiv.onclick = () => {
      videoPlayer.currentTime = cue.start;
    };
    messageDiv.style.cursor = 'pointer';

    messageDiv.appendChild(metaDiv);
    messageDiv.appendChild(bubbleDiv);
    transcriptDiv.appendChild(messageDiv);
  };

  // Function to load video and transcript for a given UUID
  const loadMeetingContent = async (uuid) => {
    if (!uuid) {
      transcriptDiv.textContent = 'Please select a Meeting UUID.';
      pdfButton.style.display = 'none';
      return;
    }

    // Sanitize UUID for path
    const safeUuid = uuid.replace(/[<>:"\/\\|?*=\s]/g, '_');

    try {
      // Load transcript text
      const textResponse = await fetch(`/recordings/${safeUuid}/transcript.vtt`);
      if (textResponse.ok) {
        const transcriptText = await textResponse.text();
        populateTranscript(transcriptText);
      } else {
        transcriptDiv.textContent = 'Transcript not found.';
      }

      // Load the final output video
      const videoSrc = `/recordings/${safeUuid}/final_output.mp4`;
      const vttSrc = `/recordings/${safeUuid}/transcript.vtt`;

      videoPlayer.src = videoSrc;
      vttTrack.src = vttSrc;

      // Show buttons
      summaryButton.style.display = 'block';
      pdfButton.style.display = 'block';

    } catch (error) {
      transcriptDiv.textContent = 'Error loading content: ' + error.message;
      pdfButton.style.display = 'none';
    }
  };

  // PDF Viewer functionality
  pdfButton.addEventListener('click', () => {
    if (meetingUuidSelect.value) {
      const uuid = meetingUuidSelect.value;
      pdfIframe.src = `/meeting-pdf/${encodeURIComponent(uuid)}`;
      pdfSection.style.display = 'block';
    }
  });

  hidePdfBtn.addEventListener('click', () => {
    pdfSection.style.display = 'none';
    pdfIframe.src = '';
  });

  // Summary Viewer functionality
  summaryButton.addEventListener('click', () => {
    if (meetingUuidSelect.value) {
      loadInlineSummaryContent();
    }
  });

  hideSummaryBtn.addEventListener('click', () => {
    summarySection.style.display = 'none';
    inlineSummaryContent.innerHTML = '';
  });

  // Function to load summary for the currently selected meeting
  const loadInlineSummaryContent = async () => {
    if (!meetingUuidSelect.value) {
      return;
    }

    const safeUuid = meetingUuidSelect.value.replace(/[<>:"\/\\|?*=\s]/g, '_');
    const fileName = `${safeUuid}.md`;

    try {
      const response = await fetch(`/meeting-summary/${fileName}`);
      if (response.ok) {
        const content = await response.text();
        inlineSummaryContent.innerHTML = formatMeetingSummary(content);
        summarySection.style.display = 'block';
      } else {
        inlineSummaryContent.innerHTML = 'Summary not available for this meeting.';
        summarySection.style.display = 'block';
      }
    } catch (error) {
      inlineSummaryContent.innerHTML = 'Error loading summary: ' + error.message;
      summarySection.style.display = 'block';
    }
  };

  // Handle dropdown change
  meetingUuidSelect.addEventListener('change', async () => {
    const selectedUuid = meetingUuidSelect.value;
    loadMeetingContent(selectedUuid);
  });

  // Summary functionality
  const summarySelect = document.getElementById('summary-select');
  const summaryResults = document.getElementById('summary-results');

  // Function to load available meetings for video playback dropdown
  const loadVideoMeetings = async () => {
    try {
      const configResponse = await fetch('/api/config');
      if (configResponse.ok) {
        const config = await configResponse.json();
        const availableMeetings = config.availableMeetings || [];

        // Clear existing options except the first
        while (meetingUuidSelect.children.length > 1) {
          meetingUuidSelect.removeChild(meetingUuidSelect.lastChild);
        }

        // Populate with topic names
        availableMeetings.forEach(uuid => {
          // topicToUuidMap maps topic -> uuid, we need uuid -> topic
          let topic = null;
          for (const [topicName, topicUuid] of Object.entries(topicToUuidMap)) {
            if (topicUuid === uuid) {
              topic = topicName;
              break;
            }
          }

          // Show topic + short UUID for identification
          const shortUuid = uuid.replace(/[_]/g, '').substring(0, 8);
          const displayText = topic ? `${topic} (${shortUuid}...)` : `Meeting ${shortUuid}...`;

          const option = document.createElement('option');
          option.value = uuid;
          option.textContent = displayText;
          meetingUuidSelect.appendChild(option);
        });
      } else {
        console.error('Failed to load meeting config');
      }
    } catch (error) {
      console.error('Error loading video meetings:', error);
    }
  };

  // Function to load summary files
  const loadSummaryFiles = async () => {
    // Wait for topics to load first
    if (Object.keys(topicToUuidMap).length === 0) {
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait a bit for topics to load
    }

    try {
      const response = await fetch('/meeting-summary-files');
      if (response.ok) {
        const files = await response.json();
        summarySelect.innerHTML = '<option value="">Select a meeting summary...</option>';
        console.log('Processing summary files, topic map:', topicToUuidMap);
        files.forEach(file => {
          // Remove .md extension and find topic
          const uuid = file.replace('.md', '');
          console.log(`Processing file: ${file}, extracted UUID: ${uuid}`);
          const topic = Object.keys(topicToUuidMap).find(t => topicToUuidMap[t] === uuid) || file;
          console.log(`Found topic for UUID ${uuid}: ${topic}`);

          const option = document.createElement('option');
          option.value = uuid; // Use UUID as value for consistency
          option.textContent = topic; // Display topic
          summarySelect.appendChild(option);
        });
      } else {
        console.error('Failed to load summary files');
      }
    } catch (error) {
      console.error('Error loading summary files:', error);
    }
  };



  // Function to load summary content
  const loadSummaryContent = async (uuid) => {
    if (!uuid) {
      summaryResults.innerHTML = '';
      return;
    }
    // Convert UUID to filename format
    const safeFileName = uuid.replace(/[<>:"\/\\|?*=\s]/g, '_') + '.md';
    try {
      const response = await fetch(`/meeting-summary/${safeFileName}`);
      if (response.ok) {
        const content = await response.text();
        summaryResults.innerHTML = `<pre style="white-space: pre-wrap; font-family: monospace;">${content}</pre>`;
      } else {
        summaryResults.innerHTML = 'Error loading summary.';
      }
    } catch (error) {
      summaryResults.innerHTML = 'Error loading summary.';
    }
  };

  // Handle summary dropdown change
  summarySelect.addEventListener('change', async () => {
    const selectedFile = summarySelect.value;
    loadSummaryContent(selectedFile);
  });

  // Real-time dashboard variables
  let realTimeWebSocket = null;
  let sentimentChart = null;
  let currentSentimentData = {};

  // Initialize D3.js sentiment chart
  const initializeSentimentChart = () => {
    const container = d3.select('#rt-sentiment-chart');
    container.html(''); // Clear previous chart

    const margin = { top: 20, right: 20, bottom: 50, left: 60 };
    const width = container.node().getBoundingClientRect().width - margin.left - margin.right;
    const height = 200 - margin.top - margin.bottom;

    const svg = container
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    sentimentChart = { svg, width, height, container };
  };

  // Update sentiment chart with new data - always redraw everything
  const updateSentimentChart = (sentimentData) => {
    if (Object.keys(sentimentData).length === 0) {
      console.log('No sentiment data to display');
      return;
    }

    // Always reinitialize to ensure clean redraw
    initializeSentimentChart();

    if (!sentimentChart) {
      console.log('Chart not initialized');
      return;
    }

    console.log('Updating sentiment chart with:', sentimentData);

    const { svg, width, height } = sentimentChart;

    // Prepare data for stacked bar chart
    const users = Object.keys(sentimentData);
    const colors = ['#dc3545', '#ffc107', '#28a745']; // negative, neutral, positive

    // Calculate totals and prepare stacked data
    const stackedData = users.map(user => {
      const data = sentimentData[user];
      return {
        user,
        negative: data.negative || 0,
        neutral: data.neutral || 0,
        positive: data.positive || 0,
        total: (data.negative || 0) + (data.neutral || 0) + (data.positive || 0)
      };
    });

    console.log('Processed stacked data:', stackedData);

    // Add some padding for better visualization if no data
    const maxTotal = d3.max(stackedData, d => d.total) || 10;
    const yDomainMax = Math.max(maxTotal * 1.1, 10); // At least 10 for scale

    // Scales
    const xScale = d3.scaleBand()
      .domain(stackedData.map(d => d.user))
      .range([0, width])
      .padding(0.2); // More padding for better spacing

    const yScale = d3.scaleLinear()
      .domain([0, yDomainMax])
      .range([height, 0]);

    // Create stacked bars
    const stack = d3.stack()
      .keys(['negative', 'neutral', 'positive']);

    const series = stack(stackedData);
    console.log('Stacked series:', series);

    // Create layers for each sentiment type
    series.forEach((layer, i) => {
      svg.selectAll(`.bar-negative-${i}`)
        .data(layer)
        .enter().append('rect')
        .attr('class', `bar-negative-${i}`)
        .attr('x', d => xScale(d.data.user))
        .attr('y', d => yScale(d[1]))
        .attr('height', d => Math.max(0, yScale(d[0]) - yScale(d[1])))
        .attr('width', xScale.bandwidth())
        .attr('fill', colors[i])
        .attr('stroke', '#fff')
        .attr('stroke-width', 1);
    });

    // Add axes
    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(xScale))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end')
      .style('font-size', '10px');

    svg.append('g')
      .call(d3.axisLeft(yScale))
      .selectAll('text')
      .style('font-size', '10px');

    // Add legend
    const legend = svg.append('g')
      .attr('transform', `translate(${width - 80}, 10)`);

    const legendData = [
      { label: 'Negative', color: colors[0] },
      { label: 'Neutral', color: colors[1] },
      { label: 'Positive', color: colors[2] }
    ];

    legendData.forEach((d, i) => {
      const legendRow = legend.append('g')
        .attr('transform', `translate(0, ${i * 15})`);

      legendRow.append('rect')
        .attr('width', 10)
        .attr('height', 10)
        .attr('fill', d.color);

      legendRow.append('text')
        .attr('x', 15)
        .attr('y', 9)
        .style('font-size', '10px')
        .style('text-anchor', 'start')
        .text(d.label);
    });

    console.log('Sentiment chart updated successfully');
  };



  // Helper to get live stream ID for a meeting
  const getLiveStreamId = async (meetingUuid) => {
    try {
      console.log('getLiveStreamId called with meetingUuid:', meetingUuid);
      const response = await fetch(`/api/live-stream?meetingUuid=${meetingUuid}`);
      if (response.ok) {
        const data = await response.json();
        console.log('getLiveStreamId response:', data);
        return data.streamId;
      }
      console.warn('getLiveStreamId failed with status:', response.status);
      return null;
    } catch (error) {
      console.error('Error fetching live stream ID:', error);
      return null;
    }
  };

  // WebSocket connection for real-time dashboard
  const connectRealTimeWebSocket = async (meetingUuid) => {
    try {
      // Load WebSocket configuration
      const configResponse = await fetch('/api/config');
      if (!configResponse.ok) {
        throw new Error('Failed to load WebSocket configuration');
      }

      const config = await configResponse.json();
      let websocketUrl = config.websocketUrl;

      // Ensure WebSocket URL has proper protocol
      if (!websocketUrl.startsWith('ws://') && !websocketUrl.startsWith('wss://')) {
        // Default to ws:// for local development, wss:// for remote servers
        const isLocalhost = websocketUrl.startsWith('localhost') || websocketUrl.startsWith('127.0.0.1');
        websocketUrl = (isLocalhost ? 'ws://' : 'wss://') + websocketUrl;
      }

      // Fetch live stream ID
      const streamId = await getLiveStreamId(meetingUuid || 'global');
      console.log('Live stream ID:', streamId);

      // Don't connect if there's no active stream
      if (!streamId) {
        console.warn('No active stream found, skipping WebSocket connection');
        const statusEl = document.getElementById('rt-connection-status');
        statusEl.textContent = '⚫ No Active Stream';
        statusEl.className = 'status-disconnected';
        return;
      }

      // Use streamId for connection
      websocketUrl = `${websocketUrl}?streamId=${streamId}`;

      console.log('Connecting to real-time WebSocket:', websocketUrl);

      // Update connection status
      const statusEl = document.getElementById('rt-connection-status');
      statusEl.textContent = '🟡 Connecting...';
      statusEl.className = 'status-connecting';

      realTimeWebSocket = new WebSocket(websocketUrl);
      let keepAliveInterval = null;

      realTimeWebSocket.onopen = () => {
        console.log('Real-time WebSocket connected');
        statusEl.textContent = '🟢 Connected - Active';
        statusEl.className = 'status-connected';

        // Initialize sentiment chart when connected
        initializeSentimentChart();

        // Client-side keep-alive: Send periodic heartbeat messages
        // This helps detect if connection is still alive and responsive
        keepAliveInterval = setInterval(() => {
          if (realTimeWebSocket.readyState === WebSocket.OPEN) {
            // Send a heartbeat message that server can ignore if it wants
            realTimeWebSocket.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
          }
        }, 25000); // Every 25 seconds (slightly less than server ping interval)
      };

      realTimeWebSocket.onmessage = (event) => {
        try {
          // Update connection status to show we've received data
          if (statusEl.className === 'status-connected') {
            statusEl.textContent = '🟢 Connected - Active';
          }

          const data = JSON.parse(event.data);
          handleWebSocketMessage(data);
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };

      realTimeWebSocket.onclose = (event) => {
        console.log('Real-time WebSocket disconnected, code:', event.code, 'reason:', event.reason);
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          keepAliveInterval = null;
        }
        const statusEl = document.getElementById('rt-connection-status');
        statusEl.textContent = '🔴 Disconnected';
        statusEl.className = 'status-disconnected';
      };

      realTimeWebSocket.onerror = (error) => {
        console.error('Real-time WebSocket error:', error);
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          keepAliveInterval = null;
        }
        const statusEl = document.getElementById('rt-connection-status');
        statusEl.textContent = '🔴 Connection Error';
        statusEl.className = 'status-disconnected';
      };

      // Add manual reconnection capability
      realTimeWebSocket.addEventListener('close', () => {
        // Auto-reconnect after 5 seconds
        setTimeout(() => {
          if (statusEl.className === 'status-disconnected') {
            console.log('Attempting to reconnect...');
            statusEl.textContent = '🔄 Reconnecting...';
            connectRealTimeWebSocket(meetingUuid);
          }
        }, 5000);
      });

    } catch (error) {
      console.error('Failed to connect to real-time WebSocket:', error);
      const statusEl = document.getElementById('rt-connection-status');
      statusEl.textContent = '🔴 Failed to Connect';
      statusEl.className = 'status-disconnected';
    }
  };

  // Handle WebSocket messages
  const handleWebSocketMessage = (data) => {
    console.log('Received WebSocket message:', data);

    switch (data.type) {
      case 'connected':
        console.log('WebSocket connection confirmed');
        break;

      case 'transcript':
        // Update live transcript
        const transcriptDiv = document.getElementById('rt-transcript');
        // Handle timestamp properly - could be epoch seconds or milliseconds
        let timestamp;
        try {
          if (data.timestamp > 1e12) { // Likely milliseconds
            timestamp = new Date(data.timestamp).toLocaleTimeString();
          } else { // Likely seconds
            timestamp = new Date(data.timestamp * 1000).toLocaleTimeString();
          }
        } catch (e) {
          timestamp = 'Unknown Time';
        }
        const user = data.user || 'Unknown Speaker';

        // Create chat bubble structure
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';

        const metaDiv = document.createElement('div');
        metaDiv.className = 'chat-meta';
        metaDiv.textContent = `[${timestamp}] ${user}`;

        const bubbleDiv = document.createElement('div');
        bubbleDiv.className = 'chat-bubble';
        bubbleDiv.textContent = data.text;

        messageDiv.appendChild(metaDiv);
        messageDiv.appendChild(bubbleDiv);

        transcriptDiv.appendChild(messageDiv);
        transcriptDiv.scrollTop = transcriptDiv.scrollHeight;
        break;

      case 'sentiment':
        // Update sentiment chart and info
        currentSentimentData = data.analysis || {};
        updateSentimentChart(currentSentimentData);

        // Update info section
        const infoDiv = document.getElementById('rt-sentiment-info');
        const userCount = Object.keys(currentSentimentData).length;
        const totalSentiment = Object.values(currentSentimentData).reduce((sum, user) =>
          sum + (user.positive || 0) + (user.neutral || 0) + (user.negative || 0), 0);
        infoDiv.textContent = `${userCount} users • ${totalSentiment} total sentiment instances`;
        break;

      case 'ai_dialog':
        // Update dialog suggestions
        const dialogDiv = document.getElementById('rt-dialog-suggestions');
        if (data.suggestions && data.suggestions.length > 0) {
          dialogDiv.innerHTML = `<div class="suggestion-bubbles">
            ${data.suggestions.map(suggestion =>
            `<div class="suggestion-chip static">${suggestion}</div>`
          ).join('')}
          </div>`;
        } else {
          dialogDiv.innerHTML = '<p>No suggestions available at this time.</p>';
        }
        break;

      case 'meeting_summary':
        // Update real-time meeting summary
        const summaryDiv = document.getElementById('rt-summary-content');
        summaryDiv.innerHTML = formatMeetingSummary(data.summary);
        break;

      case 'stream_ended':
        console.log('Stream ended event received');
        const statusEl = document.getElementById('rt-connection-status');
        statusEl.textContent = '🔴 Meeting Ended';
        statusEl.className = 'status-disconnected';

        // Clear UI or show ended state
        const transcriptDivEnded = document.getElementById('rt-transcript');
        const endMessage = document.createElement('div');
        endMessage.className = 'chat-message';
        endMessage.innerHTML = '<div class="chat-meta">System</div><div class="chat-bubble" style="background-color: #f8d7da; color: #721c24;">Meeting has ended.</div>';
        transcriptDivEnded.appendChild(endMessage);
        transcriptDivEnded.scrollTop = transcriptDivEnded.scrollHeight;

        // Close WebSocket
        if (realTimeWebSocket) {
          realTimeWebSocket.close();
        }
        break;


      default:
        console.log('Unknown WebSocket message type:', data.type);
    }
  };

  // Real-time query functionality
  document.getElementById('rt-query-button')?.addEventListener('click', async () => {
    const queryInput = document.getElementById('rt-query-input');
    const resultsDiv = document.getElementById('rt-query-results');
    const rtLoader = document.getElementById('rt-loading-spinner');

    if (!queryInput || !resultsDiv || !rtLoader) return;

    const query = queryInput.value.trim();
    if (!query) {
      resultsDiv.innerHTML = 'Please enter a question about the meeting.';
      return;
    }

    // Show loader, hide results
    rtLoader.style.display = 'flex';
    resultsDiv.style.display = 'none';
    resultsDiv.innerHTML = '';

    const urlMeetingUuid = new URLSearchParams(window.location.search).get('meeting');

    let meetingUuid = urlMeetingUuid;

    if (!meetingUuid) {
      try {
        const configResponse = await fetch('/api/config');
        const config = await configResponse.json();
        if (config.availableMeetings && config.availableMeetings.length > 0) {
          meetingUuid = config.availableMeetings[0];
        } else {
          meetingUuid = 'global';
        }
      } catch (e) {
        console.error('Error fetching config:', e);
        meetingUuid = 'global';
      }
    }

    console.log('meetinguuid:', meetingUuid);
    console.log('query:', query);

    try {
      const response = await fetch('/api/meeting-query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          meetingUuid: meetingUuid
        })
      });

      if (response.ok) {
        const data = await response.json();
        resultsDiv.innerHTML = data.answer;
      } else {
        resultsDiv.innerHTML = 'Failed to get response from AI.';
      }
    } catch (error) {
      console.error('Query error:', error);
      resultsDiv.innerHTML = 'Error connecting to AI service.';
    } finally {
      // Hide loader, show results
      rtLoader.style.display = 'none';
      resultsDiv.style.display = 'block';
    }
  });

  // Initialize the application - load topics first, then enable functionality
  // Utility to sanitize filenames (matching backend logic)
  const sanitizeFileName = (name) => {
    return name.replace(/[<>:"\/\\|?*=\s]/g, '_');
  };

  const initializeApp = async () => {
    console.log('Initializing application...');

    // Load topics first (required for search functionality)
    const topicsLoaded = await loadMeetingTopics();
    if (topicsLoaded) {
      console.log('Topics loaded successfully - enabling search functionality');

      // Load summary files
      loadSummaryFiles();

      // Helper to get meeting context
      const getMeetingUUID = async () => {
        let sdkUuid = null;

        // 1. Check Zoom SDK if available (Prioritize SDK as source of truth)
        if (typeof zoomSdk !== 'undefined') {
          console.log('Zoom SDK is defined, attempting to get meeting UUID...');
          try {
            // Configure the SDK first
            console.log('Configuring Zoom SDK...');
            await zoomSdk.config({
              version: '1.10.0',
              capabilities: ['getMeetingUUID']
            });
            console.log('Zoom SDK configured successfully');

            // Create a promise for the SDK call
            const sdkPromise = new Promise((resolve) => {
              try {
                if (zoomSdk.getMeetingUUID) {
                  console.log('Calling zoomSdk.getMeetingUUID()...');
                  zoomSdk.getMeetingUUID().then(result => {
                    console.log('=== ZOOM SDK RESULT ===');
                    console.log('Full result object:', JSON.stringify(result, null, 2));
                    console.log('========================');
                    // The SDK returns an object like { meetingUUID: "62B0F5/JTyqAw20Ys52NqQ==" }
                    if (result && result.meetingUUID) {
                      console.log('✓ Found meetingUUID:', result.meetingUUID);
                      resolve(result.meetingUUID);
                    } else {
                      console.warn('✗ SDK result missing meetingUUID property');
                      console.warn('Available properties:', Object.keys(result || {}));
                      resolve(null);
                    }
                  }).catch(err => {
                    console.error('zoomSdk.getMeetingUUID() failed:', err);
                    resolve(null);
                  });
                } else {
                  console.warn('zoomSdk.getMeetingUUID is not a function');
                  resolve(null);
                }
              } catch (e) {
                console.error('Error calling zoomSdk.getMeetingUUID:', e);
                resolve(null);
              }
            });

            // Create a timeout promise (increased to 5s)
            const timeoutPromise = new Promise(resolve => {
              setTimeout(() => {
                console.warn('Zoom SDK UUID retrieval timed out');
                resolve(null);
              }, 5000);
            });

            // Race them
            sdkUuid = await Promise.race([sdkPromise, timeoutPromise]);
            if (sdkUuid) {
              console.log('Raw Meeting UUID from SDK:', sdkUuid);
              const sanitizedSdkUuid = sanitizeFileName(sdkUuid);
              console.log('Sanitized Meeting UUID from SDK:', sanitizedSdkUuid);
              return sanitizedSdkUuid;
            }
          } catch (e) {
            console.error('Error accessing Zoom SDK:', e);
          }
        } else {
          console.log('Zoom SDK is undefined');
        }

        // 2. Check URL if SDK failed or not available
        const urlParams = new URLSearchParams(window.location.search);
        const urlMeetingUuid = urlParams.get('meeting');
        if (urlMeetingUuid) {
          console.log('Raw Meeting UUID from URL:', urlMeetingUuid);
          const sanitizedUrlUuid = sanitizeFileName(urlMeetingUuid);
          console.log('Sanitized Meeting UUID from URL:', sanitizedUrlUuid);
          return sanitizedUrlUuid;
        }

        // 3. Mock check for Zoom client (if SDK failed or not found)
        const isZoomClient = navigator.userAgent.includes('Zoom');
        if (isZoomClient) {
          console.log('User Agent indicates Zoom client, but SDK context failed and no URL param.');
        }

        return null;
      };

      const meetingUuid = await getMeetingUUID();
      console.log('Final UUID to be used for lookup:', meetingUuid);

      // If still no UUID, try to get from config (fallback for dev/demo)
      let finalMeetingUuid = meetingUuid;
      if (!finalMeetingUuid || finalMeetingUuid === 'global') {
        console.log('No specific meeting UUID found, checking /api/config for available meetings...');
        try {
          const configResponse = await fetch('/api/config');
          const config = await configResponse.json();
          if (config.availableMeetings && config.availableMeetings.length > 0) {
            // Use the first available meeting as default if none specified
            // This is useful for the demo environment
            finalMeetingUuid = config.availableMeetings[0];
            console.log('Using fallback meeting from config:', finalMeetingUuid);
          } else {
            console.log('No available meetings in config.');
          }
        } catch (e) {
          console.error('Error fetching config for fallback:', e);
        }
      }

      // Final fallback to 'global' if absolutely nothing else works
      finalMeetingUuid = finalMeetingUuid || 'global';
      console.log('Final resolved meeting UUID for WebSocket:', finalMeetingUuid);

      connectRealTimeWebSocket(finalMeetingUuid);

    } else {
      console.error('Failed to load topics - search functionality may be limited');
      // Still allow basic functionality even if topics fail
      loadSummaryFiles();
      connectRealTimeWebSocket('global');
    }
  };

  // Start the app
  initializeApp();

  // Collapsible Panels Logic
  const rtPanels = document.querySelectorAll('.rt-panel h4');
  rtPanels.forEach(header => {
    header.addEventListener('click', () => {
      const panel = header.parentElement;
      panel.classList.toggle('collapsed');
    });
  });

  // Context Awareness - Auto-switch to Real-time tab if in meeting
  if (typeof zoomSdk !== 'undefined') {
    zoomSdk.getRunningContext().then(context => {
      console.log('Running Context:', context);
      if (context === 'inMeeting' || context === 'inMeetingChat') {
        // Find the Real-time tab button
        const realTimeTabBtn = document.querySelector('.nav-item[data-tab="realtime"]');
        if (realTimeTabBtn) {
          realTimeTabBtn.click();
          console.log('Auto-switched to Real-time tab due to in-meeting context');
        }
      }
    }).catch(err => {
      console.log('Error checking running context:', err);
    });
  }
});
