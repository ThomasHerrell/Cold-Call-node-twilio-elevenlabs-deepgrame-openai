require("dotenv").config();
require("colors");

const express = require("express");
const ExpressWs = require("express-ws");
const bodyParser = require("body-parser");
const { chromium } = require("playwright");
const WebSocket = require("ws");
const { GptService } = require("./services/gpt-service");
const  {GptService_Incoming} = require("./services/gpt-service-incoming")
const { StreamService } = require("./services/stream-service");
const { TranscriptionService } = require("./services/transcription-service");
const { TextToSpeechService } = require("./services/tts-service");
const { recordingService } = require("./services/recording-service");
const cors = require("cors");
const { chatGpt, getData_Calendly } = require("./services/checkschedule");
const { get_Avaliable_time } = require("./services/getAvaliableTime");
const { makeschedule } = require("./services/make-schedule");
const makeCallRouter = require("./makeCall");
const callStatusRouter = require("./routes/callStatus");
const VoiceResponse = require("twilio").twiml.VoiceResponse;
const path = require("path");

const fs = require('fs');
var phonenumberlist;
var contact_id = "";
var campaign_id = "";
var avaliable_times_info;
var ai_profile_name = "Brandon";
var fullname = "Elina";
var voiceId;

var content = "";
var todo = "";
var notodo = "";
var email = "";
var company = "";
var contact_company = "";
var contact_position = "";
var stability = "";
var style_exaggeration = "";
var similarity_boost = "";
var phonenumber = "";
var calendarlink = "";
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = require("twilio")(accountSid, authToken);
const twilio = require('twilio');

const app = express();
ExpressWs(app);

const PORT = process.env.PORT || 3000;
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);
app.use(bodyParser.json({limit: '50mb'}));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use("/api", makeCallRouter);
app.use("/api", callStatusRouter);


// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

console.log(process.env.TWILIO_ACCOUNT_SID);

const options = {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  hour12: false,
};
const formatter = new Intl.DateTimeFormat([], options);
const brazilHour = parseInt(formatter.format(new Date()), 10);

let timeOfDay;
if (brazilHour >= 5 && brazilHour < 12) {
  timeOfDay = "Good morning!";
} else if (brazilHour >= 12 && brazilHour < 18) {
  timeOfDay = "Good afternoon!";
} else {
  timeOfDay = "Good evening!";
}

app.post("/incoming", async (req, res) => {
  console.log("incoming");
  const response = new VoiceResponse();
  response.dial("+15312157299");
  res.type("text/xml");
  res.end(response.toString());
});

app.post("/outcoming", async (req, res) => {
  console.log("outcoming");
  let phonenumber = req.query.phonenumber; // Assuming contact_ID is passed in the query to identify the file
  const filePath = `./scripts/${phonenumber}.txt`;
  console.log(`filePath : ${filePath}`)

  if (fs.existsSync(filePath)) {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const contactData = JSON.parse(fileContent);

    phonenumber = contactData.phonenumber;
    todo = contactData.todo;
    notodo = contactData.notodo;
    fullname = contactData.fullname;
    ai_profile_name = contactData.ai_profile_name;
    email = contactData.email;
    company = contactData.company;
    contact_position = contactData.contact_position;
    contact_company = contactData.contact_company;
    contact_id = contactData.contact_id;
    voiceId = contactData.voiceId;
    style_exaggeration = contactData.style_exaggeration;
    stability = contactData.stability;
    similarity_boost = contactData.similarity_boost;
    calendarlink = contactData.calendarlink;
    campaign_id = contactData.campaign_id;
    content = contactData.content;
    console.log(`Content_content : ${content}`)
  } else {
    console.error(`File  not found.`);
    res.status(404).send('Contact file not found');
    return;
  }
  
  try {
    callstatus = "Not answered";
    const response = new VoiceResponse();
    const connect = response.connect();
    connect.stream({ url: `wss://${process.env.SERVER}/connection` });
    
    res.type("text/xml");
    res.end(response.toString());
  } catch (err) {
    console.log(err);
  }
});

app.ws("/connection", (ws) => {
  var communicationtext = "";
  const re_phonenumber = phonenumber;
  var _voiceId = voiceId;
  var recordingSid = '';
  var recordingUrl = '';
  console.log("connection");
  try {
    ws.on("error", console.error);
    ws.on("close", async () => {
      try {
        callstatus = await chatGpt(communicationtext);
        
        await client.recordings
          .list({ callSid: callSid }) // Replace with your actual callSid
          .then((recordings) => {
            return Promise.all(recordings.map((recording) => {
              console.log(`Recording SID: ${recording.sid}`); 
              console.log('--------------Recording Url:', recording.uri); // This is your recordingSid
              recordingSid = recording.sid;

              return client.recordings(recordingSid)
                .fetch()
                .then(recording => {
                  recordingUrl = `https://api.twilio.com${recording.uri.replace('.json', '.mp3')}`;
                  console.log(recordingUrl);
                });
            }));
          })
          .catch((error) => console.error(error));

        // await updateData(communicationtext, _contactID, _campaignID, callstatus, recordingUrl);
        // const schedule_date_time = await getData_Calendly(
        //   callstatus,
        //   calendarlink
        // );
        // console.log(callstatus);
        // console.log(schedule_date_time);
        // makeschedule(schedule_date_time, _full_name, contact_email);
      } catch (error) {
        console.error("Error processing stop event:", error);
      }
    });

    let streamSid;
    let callSid;
    let currentIcount = 0;

    const gptService = new GptService();
    const streamService = new StreamService(ws);
    const transcriptionService = new TranscriptionService();
    const ttsService = new TextToSpeechService({});
    let marks = [];
    let interactionCount = 0;
    var contact;
    contact = {
      name: fullname,
      position: contact_position,
      company: contact_company,
    };

    //    Incoming from MediaStream
    ws.on("message", async function message(data) {
      const msg = JSON.parse(data);
      if (msg.event === "start" && msg.start && msg.start.streamSid) {
        console.log("start");
        streamSid = msg.start.streamSid;
        callSid = msg.start.callSid;
        console.log(`Received phonenumber: ${re_phonenumber}`);
        console.log(streamSid);
        streamService.setStreamSid(streamSid);
        // gptService.setCallSid(callSid);
        console.log(`Content: ${content}`);

        ttsService.generate(
          {
            partialResponseIndex: null,
            partialResponse: `${content}`,
          },
          0,
        );
        // gptService.setUserContext(
        //   content,
        //   todo,
        //   notodo,
        //   'David',
        //   'Sean'
        // );
        // Set RECORDING_ENABLED='true' in .env to record calls
        recordingService(ttsService, callSid).then(() => {
          console.log(
            `Twilio -> Starting Media Stream for ${streamSid}`.underline.red
          );
        });
      } else if (msg.event === "media") {
        // transcriptionService.send(msg.media.payload);
      } else if (msg.event === "mark") {
        const label = msg.mark.name;
        console.log(
          `Twilio -> Audio completed mark (${msg.sequenceNumber}): ${label}`.red
        );
        marks = marks.filter((m) => m !== msg.mark.name);
      } else if (msg.event === "stop") {
        console.log(`Twilio -> Media stream ${streamSid} ended.`.underline.red);
        console.log(`Context : ${communicationtext}`);
      }
    });

    transcriptionService.on("utterance", async (text) => {
      if (marks.length > 0 && text?.length > 5) {
        console.log("Twilio -> Interruption, Clearing stream".red);
        ws.send(
          JSON.stringify({
            streamSid,
            event: "clear",
          })
        );
      }
    });

    // transcriptionService.on("transcription", async (text) => {
    //   if (!text) {
    //     return;
    //   }
    //   if (text.includes("UtteranceEnd")) {
    //     hangUpCall(callSid);
    //   }
    //   console.log(
    //     `Interaction ${interactionCount} : STT -> GPT: ${text}`.yellow
    //   );
    //   console.log(`phonenumber : ${re_phonenumber}`);
    //   communicationtext += `Contact: ${text}\n`;

    //   if (interactionCount !== currentIcount) {
    //     gptService.stop(currentIcount);
    //     currentIcount = interactionCount;
    //   }

    //   gptService.completion(text, interactionCount);
    //   interactionCount += 1;
    // });

    gptService.on("gptreply", async (gptReply, icount) => {
      console.log(
        `Interaction ${icount}: GPT -> TTS: ${gptReply.partialResponse}`.green
      );
      // if (icount !== currentIcount) {
      //   ttsService.stop(currentIcount);
      //   currentIcount = icount;
      // }

      ttsService.generate(
        gptReply,
        icount,
      );
    });

    ttsService.on("speech", (responseIndex, audio, label, icount) => {
      console.log(`Interaction ${icount}: TTS -> TWILIO: ${label}`.blue);
      communicationtext += ` Ai-agent: ${label}\n`;
      streamService.buffer(responseIndex, audio);
    });
    streamService.on("audiosent", (markLabel) => {
      marks.push(markLabel);
    });
  } catch (err) {
    console.log(err);
  }
});





app.listen(PORT);
console.log(`Server running on port ${PORT}`);
