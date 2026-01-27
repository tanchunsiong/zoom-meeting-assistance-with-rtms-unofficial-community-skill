// chatWithClawdbot.js
import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const CLAWDBOT_BIN = process.env.CLAWDBOT_BIN || 'clawdbot';
const CLAWDBOT_TIMEOUT = parseInt(process.env.CLAWDBOT_TIMEOUT || '120') * 1000;

/**
 * Run a clawdbot agent task and return the response text.
 * @param {string} message - The prompt/message
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<string>}
 */
function runClawdbot(message, timeout = CLAWDBOT_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const args = ['agent', '--local', '--json', '--message', message];
    const child = execFile(CLAWDBOT_BIN, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        console.error('❌ Clawdbot error:', err.message);
        if (stderr) console.error('stderr:', stderr);
        return reject(err);
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result.reply || result.message || result.content || stdout.trim());
      } catch {
        // Not JSON, return raw output
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * Sends a message to Clawdbot agent for processing
 * @param {string} message - The user message
 * @param {string} _model - Ignored (uses Clawdbot's configured model)
 * @param {string[]} images - Base64 images (passed as context in prompt)
 * @param {boolean} isRetry - Whether this is a retry
 * @returns {Promise<string>}
 */
export async function chatWithClawdbot(message, _model = '', images = [], isRetry = false) {
  try {
    let fullMessage = message;

    // If images are provided, mention them in the prompt
    // (Clawdbot agent can process text but images need to be described)
    if (images.length > 0) {
      fullMessage += `\n\n[Note: ${images.length} image(s) were captured from screen share but cannot be passed directly. Please analyze based on the text/transcript content provided.]`;
    }

    console.log('🤖 Sending to Clawdbot agent...');
    const response = await runClawdbot(fullMessage);
    return response;
  } catch (err) {
    console.error('❌ Error with Clawdbot:', err.message);

    if (!isRetry) {
      console.log('🔄 Retrying Clawdbot...');
      return await chatWithClawdbot(message, _model, images, true);
    }

    throw err;
  }
}

/**
 * Fast/lightweight chat (same as regular for Clawdbot — no separate fast model)
 * @param {string} message
 * @returns {Promise<string>}
 */
export async function chatWithClawdbotFast(message) {
  try {
    console.log('🤖 Sending to Clawdbot agent (fast)...');
    return await runClawdbot(message);
  } catch (err) {
    console.error('❌ Error with Clawdbot:', err.message);
    throw err;
  }
}

/**
 * Generate strategic dialog suggestions for meeting facilitation
 * @param {string} transcript - Full meeting transcript text
 * @returns {Promise<string[]>} Array of 4 RPG-style dialog suggestions
 */
export async function generateDialogSuggestions(transcript) {
  try {
    const dialogPromptTemplate = readFileSync('query_prompt_dialog_suggestions.md', 'utf-8');
    const filledPrompt = dialogPromptTemplate.replace(/\{\{meeting_transcript\}\}/g, transcript);

    console.log('🗣️ Generating dialog suggestions via Clawdbot...');
    const response = await runClawdbot(filledPrompt);

    const suggestions = response
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('Response:') && !line.startsWith('Only return'));

    console.log(`✅ Generated ${suggestions.length} dialog suggestions`);
    return suggestions.slice(0, 4);
  } catch (err) {
    console.error('❌ Error generating dialog suggestions:', err.message);
    return [
      "Continue exploring the key points raised so far",
      "Invite participants to share their perspectives",
      "Summarize the discussion and identify next priorities",
      "Seek consensus on the primary objectives"
    ];
  }
}

/**
 * Analyze sentiment from full meeting transcript for multiple users
 * @param {string} transcript - Full meeting transcript text
 * @returns {Promise<Object>} Object with user keys and {positive, neutral, negative} values
 */
export async function analyzeSentiment(transcript) {
  try {
    const sentimentPromptTemplate = readFileSync('query_prompt_sentiment_analysis.md', 'utf-8');
    const filledPrompt = sentimentPromptTemplate.replace(/\{\{meeting_transcript\}\}/g, transcript);

    console.log('😊 Analyzing sentiment via Clawdbot...');
    const response = await runClawdbot(filledPrompt);

    let jsonContent = response.trim();
    if (jsonContent.startsWith('```json')) {
      jsonContent = jsonContent.replace(/```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonContent.startsWith('```')) {
      jsonContent = jsonContent.replace(/```\s*/, '').replace(/\s*```$/, '');
    }

    try {
      const sentimentData = JSON.parse(jsonContent);
      console.log('✅ Sentiment analysis completed:', Object.keys(sentimentData).length, 'users analyzed');
      return sentimentData;
    } catch (parseError) {
      console.error('❌ Error parsing sentiment JSON:', parseError.message);
      return {};
    }
  } catch (err) {
    console.error('❌ Error analyzing sentiment:', err.message);
    return {};
  }
}

/**
 * Generate a real-time meeting summary from transcript and images
 * @param {string} transcript - Full current meeting transcript in VTT format
 * @param {string} meetingEvents - Meeting events log
 * @param {string[]} imageBase64Array - Array of base64 encoded screen share images
 * @param {string} streamId - Stream ID
 * @param {string} meetingUuid - Meeting UUID
 * @returns {Promise<string>} Real-time meeting summary
 */
export async function generateRealTimeSummary(transcript, meetingEvents = '', imageBase64Array = [], streamId = '', meetingUuid = '') {
  try {
    const summaryPromptTemplate = readFileSync('summary_prompt.md', 'utf-8');
    const todayDate = new Date().toISOString();

    const filledPrompt = summaryPromptTemplate
      .replace(/\{\{raw_transcript\}\}/g, transcript)
      .replace(/\{\{meeting_events\}\}/g, meetingEvents)
      .replace(/\{\{meeting_uuid\}\}/g, meetingUuid)
      .replace(/\{\{stream_id\}\}/g, streamId)
      .replace(/\{\{TODAYDATE\}\}/g, todayDate);

    console.log('📝 Generating real-time summary via Clawdbot...');
    const response = await chatWithClawdbot(filledPrompt, '', imageBase64Array);

    console.log('✅ Real-time summary generated');
    return response;
  } catch (err) {
    console.error('❌ Error generating real-time summary:', err.message);
    return 'Unable to generate summary at this time. Meeting in progress...';
  }
}

/**
 * Query the current meeting transcript for specific questions
 * @param {string} transcript - Full current meeting transcript
 * @param {string} userQuery - User's question about the meeting
 * @returns {Promise<string>} Contextual answer based on transcript
 */
export async function queryCurrentMeeting(transcript, userQuery) {
  try {
    const queryPromptTemplate = readFileSync('query_prompt_current_meeting.md', 'utf-8');
    const filledPrompt = queryPromptTemplate
      .replace(/\{\{meeting_transcript\}\}/g, transcript)
      .replace(/\{\{user_query\}\}/g, userQuery);

    console.log('🔍 Querying current meeting via Clawdbot...');
    const response = await runClawdbot(filledPrompt);

    console.log('✅ Meeting query answered');
    return response;
  } catch (err) {
    console.error('❌ Error querying current meeting:', err.message);
    return 'I apologize, but I was unable to analyze the current meeting transcript. Please try again later.';
  }
}
