const express = require('express');
const router = express.Router();
const { get_Avaliable_time } = require('./services/getAvaliableTime');
const { chatGpt, getData_Calendly } = require('./services/checkschedule');
const { makeschedule } = require('./services/make-schedule');
const { db } = require('./firebase/firebaseConfig');
const { collection, doc, setDoc, getDoc, getDocs } = require('firebase/firestore');
const twilio = require('twilio');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const cors = require('cors');

// Apply CORS middleware to all routes in this router
router.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

console.log(`Server URL: ${process.env.SERVER}`);

// Helper function to clean undefined values
const cleanUndefinedValues = (obj) => {
    const cleaned = {};
    Object.entries(obj).forEach(([key, value]) => {
        if (value === undefined) {
            cleaned[key] = null;
        } else if (typeof value === 'object' && value !== null) {
            cleaned[key] = cleanUndefinedValues(value);
        } else {
            cleaned[key] = value;
        }
    });
    return cleaned;
};

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

router.post('/make-call', async (req, res) => {
  const phonenumberlist = req.body.phonenumber?.split(',') || [];
  const contact_id_list = req.body.contact_id?.split(',') || [];
  const fullname = req.body.contact_name?.split(',') || [];
  const email_list = req.body.email?.split(',') || [];
  const contact_company = req.body.contact_company?.split(',') || [];
  const contact_position = req.body.contact_position?.split(',') || [];
  const company = req.body.empresa || null;  
  const voiceId = req.body.voiceId || null;
  const stability = req.body.stability || null;
  const similarity_boost = req.body.similarity_boost || null;
  const style_exaggeration = req.body.style_exaggeration || null;
  const content = req.body.content || null;
  const todo = req.body.todo || null;
  const notodo = req.body.notodo || null;
  const campaign_id = req.body.campaign_id || null;
  const ai_profile_name = req.body.ai_profile_name || null;

  console.log(`phonenumberlist : ${phonenumberlist}`)
  
  const contact = phonenumberlist.map((phonenumber, index) => ({
    phonenumber: phonenumber?.trim() || '',
    contact_id: contact_id_list[index]?.trim() || '',
    fullname: fullname[index]?.trim() || '',
    email: email_list[index]?.trim() || '', 
    contact_company: contact_company[index]?.trim() || '',
    contact_position: contact_position[index]?.trim() || '',  
    company: company,
    voiceId: voiceId,
    stability: stability,
    similarity_boost: similarity_boost,
    style_exaggeration: style_exaggeration,
    content: content?.[index]?.trim() || '',
    todo: todo,
    notodo: notodo,
    campaign_id: campaign_id,
    ai_profile_name: ai_profile_name
  }));

  console.log('body', contact);

  // Save contact information to Firebase
  for (const contactItem of contact) {
    try {
      const cleanedContact = cleanUndefinedValues(contactItem);
      const contactRef = doc(db, 'contacts', contactItem.phonenumber);
      await setDoc(contactRef, cleanedContact);
    } catch (error) {
      console.error(`Error saving contact information to Firebase for ${contactItem.phonenumber}:`, error);
    }
  }

  // Save AI profile if it doesn't exist
  try {
    if (ai_profile_name && typeof ai_profile_name === 'string' && ai_profile_name.trim() !== '') {
      const aiProfileRef = doc(db, 'ai_profiles', ai_profile_name);
      const aiProfileDoc = await getDoc(aiProfileRef);
      if (!aiProfileDoc.exists()) {
        await setDoc(aiProfileRef, cleanUndefinedValues({ content: content }));
      }
    } else {
      console.log('Skipping AI profile save: Invalid or missing ai_profile_name');
    }
  } catch (error) {
    console.error('Error saving AI profile to Firebase:', error);
    // Continue execution even if AI profile save fails
  }

  console.log(`contact : ${JSON.stringify(contact)}`);  
  console.log(phonenumberlist.length, contact_id_list.length);
  let numberIndex = 0;
  
  const fromNumbers = Array.isArray(process.env.FROM_NUMBERS) 
    ? process.env.FROM_NUMBERS 
    : process.env.FROM_NUMBERS ? process.env.FROM_NUMBERS.split(',') : [];
  
  try {
    const callPromises = contact.map(async (contactItem) => {
        console.log(`phonenumber : ${contactItem.phonenumber}`);
        const fromNumber = fromNumbers.length > 0 ? fromNumbers[numberIndex % fromNumbers.length] : '';
        numberIndex++;

        // All possible Twilio call status events
        const statusCallbackEvents = [
            'initiated',
            'ringing',
            'answered',
            'in-progress',
            'completed',
            'busy',
            'no-answer',
            'canceled',
            'failed',
            'queued'
        ];

        const call = await client.calls.create({
            url: `https://${process.env.SERVER}/outcoming?phonenumber=${encodeURIComponent(contactItem.phonenumber)}`,
            to: contactItem.phonenumber,
            from: fromNumber,
            record: true,
            method: 'POST',
            statusCallback: `https://${process.env.SERVER}/api/call-status`,
            statusCallbackEvent: statusCallbackEvents,
            statusCallbackMethod: 'POST',
            timeout: 20
        });

        // Add detailed logging for debugging
        console.log('Call details:', {
            sid: call.sid,
            status: call.status,
            direction: call.direction,
            from: call.from,
            to: call.to,
            dateCreated: call.dateCreated,
            price: call.price,
            errorCode: call.errorCode,
            errorMessage: call.errorMessage
        });

        console.log('Created call with SID:', call.sid);

        try {
            await client.calls(call.sid)
                .update({
                    statusCallback: `https://${process.env.SERVER}/api/call-status?callSid=${call.sid}`,
                    statusCallbackEvent: statusCallbackEvents,
                    statusCallbackMethod: 'POST'
                });
            console.log('Updated call with status callback:', call.sid);
        } catch (updateError) {
            console.error('Error updating call with status callback:', updateError);
        }

        const callStatus = {
            id: Date.now(),
            clientName: contactItem.fullname || 'Unknown',
            phone: contactItem.phonenumber || 'Unknown',
            status: 'initiated',
            statusCategory: 'in-progress',
            statusDescription: 'Call has been initiated',
            template: contactItem.content || '',
            timestamp: new Date().toISOString(),
            direction: 'outbound',
            metadata: {
                contactId: contactItem.contact_id || null,
                campaignId: contactItem.campaign_id || null,
                aiProfile: contactItem.ai_profile_name || null
            },
            statusHistory: [{
                timestamp: new Date().toISOString(),
                status: 'initiated',
                details: {
                    status: 'initiated',
                    description: 'Call has been initiated',
                    category: 'in-progress'
                }
            }]
        };

        // Save to Firebase
        try {
            const cleanedCallStatus = cleanUndefinedValues(callStatus);
            const callRef = doc(db, 'callStatuses', call.sid);
            await setDoc(callRef, cleanedCallStatus);
        } catch (error) {
            console.error('Error saving initial call status to Firebase:', error);
        }

        return call.sid;
    });

    const callSids = await Promise.all(callPromises);
    res.status(200).json({
        success: true,
        data: {
            callSids,
            message: 'Calls initiated successfully'
        }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
        success: false,
        message: 'Failed to initiate calls',
        error: error.message
    });
  }
});

// Add new endpoint to cancel all pending calls
router.post('/cancel-all-calls', async (req, res) => {
  try {
    const calls = await client.calls.list({status: ['queued', 'ringing', 'in-progress']});
    
    const cancelPromises = calls.map(call => 
      client.calls(call.sid)
        .update({status: 'canceled'})
        .catch(err => console.error(`Failed to cancel call ${call.sid}:`, err))
    );

    await Promise.all(cancelPromises);

    res.status(200).json({
      success: true,
      message: `Canceled ${calls.length} active calls`
    });
  } catch (error) {
    console.error('Error canceling calls:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel calls',
      error: error.message
    });
  }
});

module.exports = router;