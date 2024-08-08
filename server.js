require('dotenv').config()
const OpenAI = require('openai')
const express = require('express')
const axios = require('axios')
const { OPENAI_API_KEY, ASSISTANT_ID, NEWS_API_KEY } = process.env

const app = express()
app.use(express.json())

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
})

const assistantId = ASSISTANT_ID
let pollingInterval

async function getNewsInformation(query) {
  try {
    const response = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: query,
        apiKey: NEWS_API_KEY,
        pageSize: 10,
      },
    })

    const articles = response.data.articles
    return articles.map((article) => {
      return {
        url: article.url,
        title: article.title,
        description: article.description,
        content: article.content,
      }
    })
  } catch (error) {
    console.error('Error fetching news information:', error)
    return 'Sorry, I could not retrieve the news information at this moment.'
  }
}

async function createThread() {
  console.log('Creating a new thread...')
  const thread = await openai.beta.threads.create()
  return thread
}

async function addMessage(threadId, message) {
  console.log('Adding a new message to thread: ' + threadId)
  const response = await openai.beta.threads.messages.create(threadId, {
    role: 'user',
    content: message,
  })
  return response
}

async function runAssistant(threadId) {
  console.log('Running assistant for thread: ' + threadId)
  const response = await openai.beta.threads.runs.create(threadId, {
    assistant_id: assistantId,
  })

  return response
}

async function checkingStatus(res, threadId, runId) {
  const runObject = await openai.beta.threads.runs.retrieve(threadId, runId)

  const status = runObject.status
  console.log('Current status: ' + status)

  if (status == 'completed') {
    clearInterval(pollingInterval)

    const messagesList = await openai.beta.threads.messages.list(threadId)
    let messages = []

    messagesList.body.data.forEach((message) => {
      messages.push(message.content)
    })

    res.json({ messages })
  }

  // + Addition for function calling
  else if (status === 'requires_action') {
    console.log('requires_action.. looking for a function')

    if (runObject.required_action.type === 'submit_tool_outputs') {
      console.log('submit tool outputs ... ')
      const tool_calls = await runObject.required_action.submit_tool_outputs
        .tool_calls
      // Can be choose with conditional, if you have multiple function
      const parsedArgs = JSON.parse(tool_calls[0].function.arguments)
      console.log('Query to search for: ' + parsedArgs.query)

      const apiResponse = await getNewsInformation(parsedArgs.query)

      const run = await openai.beta.threads.runs.submitToolOutputs(
        threadId,
        runId,
        {
          tool_outputs: [
            {
              tool_call_id: tool_calls[0].id,
              output: JSON.stringify(apiResponse),
            },
          ],
        }
      )

      console.log('Run after submit tool outputs: ' + run.status)
    }
  }
}

//=========================================================
//============== ROUTE SERVER =============================
//=========================================================

// Open a new thread
app.get('/thread', (req, res) => {
  createThread().then((thread) => {
    res.json({ threadId: thread.id })
  })
})

app.post('/message', (req, res) => {
  const { message, threadId } = req.body
  addMessage(threadId, message).then((message) => {
    // res.json({ messageId: message.id });

    // Run the assistant
    runAssistant(threadId).then((run) => {
      const runId = run.id

      // Check the status
      pollingInterval = setInterval(() => {
        checkingStatus(res, threadId, runId)
      }, 5000)
    })
  })
})

// Start the server
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})
