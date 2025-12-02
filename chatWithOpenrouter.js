// openrouterChat.js
import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

// Set up OpenAI client with OpenRouter endpoint
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

/**
 * Sends a message to a model via OpenRouter
 * @param {string} message - The user message
 * @param {string} model - The model to use (e.g., 'anthropic/claude-3-haiku')
 * @returns {Promise<string>}
 */
export async function chatWithOpenRouter(message, model = process.env.OPENROUTER_MODEL || 'x-ai/grok-code-fast-1', images = [], isRetry = false) {


  try {
    const enabled = process.env.OPENROUTER_REASONING_ENABLED === 'true' || false;

    const content = [];

    // Add text message
    content.push({ type: 'text', text: message });

    // Add images if provided
    for (const imageBase64 of images) {
      content.push({
        type: 'image_url',
        image_url: {
          url: imageBase64 // Should be full data URI like "data:image/jpeg;base64,..."
        }
      });
    }

    const response = await openai.chat.completions.create({
      model: model,
      messages: [{ role: 'user', content: content }],
      ...(enabled ? { reasoning: { enabled: true } } : {})
    });

    return response.choices[0].message.content;
  } catch (err) {
    const errorMessage = err.response?.data?.error?.message || err.message || '';
    console.error('❌ Error with OpenRouter:', err.response?.data || err.message);

    // Check if error is related to image support
    const isImageSupportError = errorMessage.includes('image') || errorMessage.includes('No endpoints found');

    // If we have images and got an image support error, try google/gemini-2.5-pro (supports vision)
    if (!isRetry && images.length > 0 && isImageSupportError && model !== 'google/gemini-2.5-pro') {
      console.log('🔄 Retrying with google/gemini-2.5-pro (supports vision)...');
      return await chatWithOpenRouter(message, 'google/gemini-2.5-pro', images, true);
    }

    // Otherwise, retry with moonshotai/kimi-k2 for general errors
    if (!isRetry && model !== 'moonshotai/kimi-k2' && model !== 'google/gemini-2.5-pro') {
      console.log('🔄 Retrying with moonshotai/kimi-k2...');
      return await chatWithOpenRouter(message, 'moonshotai/kimi-k2', images, true);
    }

    // If retry failed or already using fallback, throw the error
    throw err;
  }
}
export async function chatWithOpenRouterFast(message, model = process.env.OPENROUTER_MODEL || 'openai/gpt-5-chat') {


  try {
    const enabled = process.env.OPENROUTER_REASONING_ENABLED === 'true' || false;
    const response = await openai.chat.completions.create({
      model: model,
      messages: [{ role: 'user', content: message }]
    });

    return response.choices[0].message.content;
  } catch (err) {
    console.error('❌ Error with OpenRouter:', err.response?.data || err.message);
    throw err;
  }
}

export async function chatWithMultipleModels(message) {
  const models = [
    'meta-llama/llama-4-maverick:free',
    'meta-llama/llama-4-scout:free',
  ];

  await Promise.all(models.map(async (model) => {
    try {
      const response = await openai.chat.completions.create({
        model,
        messages: [{ role: 'user', content: message }],
      });

      const reply = response.choices[0].message.content;

      console.log('='.repeat(60));
      console.log(`🧠 MODEL: ${model}`);
      console.log('-'.repeat(60));
      console.log(`💬 RESPONSE:\n${reply}`);
      console.log('='.repeat(60));
    } catch (err) {
      console.error(`❌ Error with model ${model}:`, err.response?.data || err.message);
      console.log('='.repeat(60));
    }
  }));
}

export async function contextualSynthesisFromMultipleModels(message) {
  const models = [
    'meta-llama/llama-4-maverick:free',
    'meta-llama/llama-4-scout:free',
  ];

  console.log(`📨 Received prompt: "${message}"\n`);
  console.log(`🤖 Sending prompt to ${models.length} models in parallel...\n`);

  const modelTasks = models.map(async (model) => {
    try {
      console.log(`⏳ Querying model: ${model}`);
      const response = await openai.chat.completions.create({
        model,
        messages: [{ role: 'user', content: message }],
      });

      console.log(`✅ Received response from ${model}`);
      return { model, reply: response.choices[0].message.content };
    } catch (err) {
      console.error(`❌ Error with model ${model}:`, err.response?.data || err.message);
      return null;
    }
  });

  const modelResponses = (await Promise.all(modelTasks)).filter(Boolean);

  if (modelResponses.length === 0) {
    console.error('❌ No successful responses to synthesize from.');
    return;
  }

  console.log('\n🧠 All model responses received. Preparing for synthesis...\n');

  const combinedContext = modelResponses.map(({ model, reply }) =>
    `Response from ${model}:\n${reply}`
  ).join('\n\n');

  const synthesisPrompt = `
You are an expert assistant. The user asked:

"${message}"

Here are responses from multiple AI models. Cross-check the answers, validate facts, and generate a final answer that is accurate, clear, and well-supported. Do not summarize — synthesize the best answer possible using their content.

${combinedContext}
  `.trim();

  const synthesisModel = 'anthropic/claude-3-haiku';

  try {
    console.log(`🧪 Synthesizing final answer using ${synthesisModel}...\n`);

    // Spinner: show elapsed seconds while waiting
    let seconds = 0;
    const spinner = setInterval(() => {
      seconds++;
      process.stdout.write(`⏳ Thinking... ${seconds}s\r`);
    }, 1000);

    const finalResponse = await openai.chat.completions.create({
      model: synthesisModel,
      messages: [{ role: 'user', content: synthesisPrompt }],
    });

    clearInterval(spinner);
    process.stdout.write('\n'); // move to clean line

    const finalAnswer = finalResponse.choices[0].message.content;

    console.log('\n✅ FINAL SYNTHESIZED ANSWER');
    console.log('='.repeat(60));
    console.log(finalAnswer);
    console.log('='.repeat(60));
  } catch (err) {
    console.error(`❌ Error during synthesis:`, err.response?.data || err.message);
  }
}

/**
 * Generate strategic dialog suggestions for meeting facilitation
 * @param {string} transcript - Full meeting transcript text
 * @returns {Promise<string[]>} Array of 4 RPG-style dialog suggestions
 */
export async function generateDialogSuggestions(transcript) {
  try {
    // Read and populate the dialog suggestions prompt
    const dialogPromptTemplate = await import('fs').then(fs => fs.readFileSync('query_prompt_dialog_suggestions.md', 'utf-8'));
    const filledPrompt = dialogPromptTemplate.replace(/\{\{meeting_transcript\}\}/g, transcript);

    console.log('🗣️ Generating dialog suggestions from transcript...');
    const response = await openai.chat.completions.create({
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-5-chat',
      messages: [{ role: 'user', content: filledPrompt }],
    });

    // Parse the response into an array of strings (split by newlines, filter empty)
    const suggestions = response.choices[0].message.content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('Response:') && !line.startsWith('Only return'));

    console.log(`✅ Generated ${suggestions.length} dialog suggestions`);
    return suggestions.slice(0, 4); // Ensure max 4 suggestions
  } catch (err) {
    console.error('❌ Error generating dialog suggestions:', err.message);
    return [
      "Continue exploring the key points raised so far",
      "Invite participants to share their perspectives",
      "Summarize the discussion and identify next priorities",
      "Seek consensus on the primary objectives"
    ]; // Fallback suggestions
  }
}

/**
 * Analyze sentiment from full meeting transcript for multiple users
 * @param {string} transcript - Full meeting transcript text
 * @returns {Promise<Object>} Object with user keys and {positive, neutral, negative} values
 */
export async function analyzeSentiment(transcript) {
  try {
    // Read and populate the sentiment analysis prompt
    const sentimentPromptTemplate = await import('fs').then(fs => fs.readFileSync('query_prompt_sentiment_analysis.md', 'utf-8'));
    const filledPrompt = sentimentPromptTemplate.replace(/\{\{meeting_transcript\}\}/g, transcript);

    console.log('😊 Analyzing sentiment from full transcript...');
    const response = await openai.chat.completions.create({
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-5-chat',
      messages: [{ role: 'user', content: filledPrompt }],
    });

    // Parse the JSON response
    const rawContent = response.choices[0].message.content.trim();

    // Extract JSON from response (remove any markdown formatting if present)
    let jsonContent = rawContent;
    if (rawContent.startsWith('```json')) {
      jsonContent = rawContent.replace(/```json\s*/, '').replace(/\s*```$/, '');
    } else if (rawContent.startsWith('```')) {
      jsonContent = rawContent.replace(/```\s*/, '').replace(/\s*```$/, '');
    }

    try {
      const sentimentData = JSON.parse(jsonContent);
      console.log('✅ Sentiment analysis completed:', Object.keys(sentimentData).length, 'users analyzed');
      return sentimentData;
    } catch (parseError) {
      console.error('❌ Error parsing sentiment JSON response:', parseError.message);
      console.error('Raw response:', rawContent);
      // Return empty object as fallback
      return {};
    }
  } catch (err) {
    console.error('❌ Error analyzing sentiment:', err.message);
    return {}; // Empty object as fallback
  }
}

/**
 * Generate a real-time meeting summary from transcript and images
 * @param {string} transcript - Full current meeting transcript in VTT format
 * @param {string} meetingEvents - Meeting events log (if available)
 * @param {string[]} imageBase64Array - Array of base64 encoded screen share images
 * @param {string} streamId - Stream ID
 * @param {string} meetingUuid - Meeting UUID (for backward compatibility)
 * @returns {Promise<string>} Real-time meeting summary
 */
export async function generateRealTimeSummary(transcript, meetingEvents = '', imageBase64Array = [], streamId = '', meetingUuid = '') {
  try {
    // Read and populate the summary prompt
    const summaryPromptTemplate = await import('fs').then(fs => fs.readFileSync('summary_prompt.md', 'utf-8'));
    const todayDate = new Date().toISOString(); // Full ISO date with time

    const filledPrompt = summaryPromptTemplate
      .replace(/\{\{raw_transcript\}\}/g, transcript)
      .replace(/\{\{meeting_events\}\}/g, meetingEvents)
      .replace(/\{\{meeting_uuid\}\}/g, meetingUuid)
      .replace(/\{\{stream_id\}\}/g, streamId)
      .replace(/\{\{TODAYDATE\}\}/g, todayDate);

    console.log('📝 Generating real-time stream summary...');
    const response = await chatWithOpenRouter(filledPrompt, undefined, imageBase64Array);

    console.log('✅ Real-time summary generated');
    return response;
  } catch (err) {
    console.error('❌ Error generating real-time stream summary:', err.message);
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
    // Read and populate the current meeting query prompt
    const queryPromptTemplate = await import('fs').then(fs => fs.readFileSync('query_prompt_current_meeting.md', 'utf-8'));
    const filledPrompt = queryPromptTemplate
      .replace(/\{\{meeting_transcript\}\}/g, transcript)
      .replace(/\{\{user_query\}\}/g, userQuery);

    console.log('🔍 Querying current meeting transcript...');
    const response = await openai.chat.completions.create({
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-5-chat',
      messages: [{ role: 'user', content: filledPrompt }],
    });

    const answer = response.choices[0].message.content;
    console.log('✅ Meeting query answered');
    return answer;
  } catch (err) {
    console.error('❌ Error querying current meeting:', err.message);
    return 'I apologize, but I was unable to analyze the current meeting transcript. Please try again later.';
  }
}
