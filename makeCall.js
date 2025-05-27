const express = require('express');
const router = express.Router();
const { get_Avaliable_time } = require('./services/getAvaliableTime');
const { chatGpt, getData_Calendly } = require('./services/checkschedule');
const { makeschedule } = require('./services/make-schedule');
const fs = require('fs');
const path = require('path');

router.post

router.post('/make-call', async (req, res) => {
  
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const client = require('twilio')(accountSid, authToken);
  
  const phonenumberlist = req.body.phonenumber.split(',');
  const contact_id_list = req.body.contact_id.split(',');
  const fullname = req.body.contact_name.split(',');
  const email_list = req.body.email.split(',');
  const contact_company = req.body.contact_company.split(',');
  const contact_position = req.body.contact_position.split(',');
  const company = req.body.empresa;  
  const voiceId = req.body.voiceId;
  const stability = req.body.stability;
  const similarity_boost = req.body.similarity_boost;
  const style_exaggeration = req.body.style_exaggeration;
  const content = req.body.content;
  const todo = req.body.todo;
  const notodo = req.body.notodo;
  const campaign_id = req.body.campaign_id;
  const ai_profile_name = req.body.ai_profile_name;

  console.log(`phonenumberlist : ${phonenumberlist}`)
  
  const contact = phonenumberlist.map((phonenumber, index) => ({
    phonenumber: phonenumber.trim(),
    contact_id: contact_id_list[index].trim(),
    fullname: fullname[index].trim(),
    email: email_list[index].trim(), 
    contact_company: contact_company[index].trim(),
    contact_position: contact_position[index].trim(),  
    company: company,
    voiceId: voiceId,
    stability: stability,
    similarity_boost: similarity_boost,
    style_exaggeration: style_exaggeration,
    content : content[index].trim(),
    todo : todo,
    notodo : notodo,
    campaign_id : campaign_id,
    ai_profile_name : ai_profile_name
  }));



  console.log('body', contact);
  const scriptsDir = path.join(__dirname, 'scripts');

  // Check if the scripts folder exists, if not, create it
  if (!fs.existsSync(scriptsDir)) {
      fs.mkdirSync(scriptsDir);
  }
    // Save contact information to [contactid].txt
    contact.forEach(contactItem => {
      const contactData = JSON.stringify(contactItem, null, 2);
      fs.writeFileSync(`${scriptsDir}/${contactItem.phonenumber}.txt`, contactData, 'utf8');
    });
    if (!fs.existsSync(`${scriptsDir}/${ai_profile_name}.txt`)) {
      fs.writeFileSync(`${scriptsDir}/${ai_profile_name}.txt`, content, 'utf8');
    }

  console.log(`contact : ${JSON.stringify(contact)}`);  
  console.log(phonenumberlist.length, contact_id_list.length);
  let numberIndex = 0;
  
  // Convert FROM_NUMBERS string to array if it's not already an array
  const fromNumbers = Array.isArray(process.env.FROM_NUMBERS) 
    ? process.env.FROM_NUMBERS 
    : process.env.FROM_NUMBERS ? process.env.FROM_NUMBERS.split(',') : [];
  
  try {
    const callPromises = contact.map(async (contactItem) => {
        console.log(`phonenumber : ${contactItem.phonenumber}`);
        const fromNumber = fromNumbers.length > 0 ? fromNumbers[numberIndex % fromNumbers.length] : '';
        numberIndex++;
        // Create call with status callback
        const call = await client.calls.create({
            url: `https://${process.env.SERVER}/outcoming?phonenumber=${encodeURIComponent(contactItem.phonenumber)}`,
            to: contactItem.phonenumber,
            from: fromNumber,
            record: true,
            method: 'POST',
            statusCallback: `https://${process.env.SERVER}/api/call-status`,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
            statusCallbackMethod: 'POST',
            timeout: 30
        });

        console.log('Created call with SID:', call.sid);

        // Update call with status callback after creation
        try {
            await client.calls(call.sid)
                .update({
                    statusCallback: `https://${process.env.SERVER}/api/call-status?callSid=${call.sid}`,
                    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
                    statusCallbackMethod: 'POST'
                });
            console.log('Updated call with status callback:', call.sid);
        } catch (updateError) {
            console.error('Error updating call with status callback:', updateError);
        }

        // Save initial call status
        const callStatus = {
            id: Date.now(),
            clientName: contactItem.fullname,
            phone: contactItem.phonenumber,
            status: 'pending',
            template: contactItem.content,
            timestamp: new Date().toISOString(),
            direction: 'outbound',
            metadata: {
                contactId: contactItem.contact_id,
                campaignId: contactItem.campaign_id,
                aiProfile: contactItem.ai_profile_name
            }
        };

        // Save to file for persistence
        const statusDir = path.join(__dirname, 'call-statuses');
        if (!fs.existsSync(statusDir)) {
            fs.mkdirSync(statusDir);
        }
        fs.writeFileSync(
            `${statusDir}/${call.sid}.json`,
            JSON.stringify(callStatus, null, 2),
            'utf8'
        );

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

module.exports = router;