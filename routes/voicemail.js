const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');
const { leaveVoicemail, loadContactInfo, generateVoicemailTwiML } = require('../services/voicemail-service');
const VoiceResponse = require('twilio').twiml.VoiceResponse;

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

// Endpoint to send a direct voicemail
router.post('/send', async (req, res) => {
    try {
        const { 
            phoneNumber, 
            message, 
            contactId, 
            customGreeting, 
            customEnding,
            skipContactLookup = false
        } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({
                success: false,
                message: 'Phone number is required'
            });
        }
        
        // Load contact info based on contact ID or phone number
        let contactInfo = null;
        if (!skipContactLookup) {
            if (contactId) {
                // Find contact file by contact ID if provided
                const scriptsDir = path.join(__dirname, '..', 'scripts');
                if (fs.existsSync(scriptsDir)) {
                    const files = fs.readdirSync(scriptsDir);
                    for (const file of files) {
                        if (file.endsWith('.txt') && !file.includes('_')) {
                            try {
                                const content = fs.readFileSync(path.join(scriptsDir, file), 'utf8');
                                const data = JSON.parse(content);
                                if (data.contact_id === contactId) {
                                    contactInfo = data;
                                    break;
                                }
                            } catch (err) {
                                // Skip invalid files
                            }
                        }
                    }
                }
            } else {
                // Load by phone number
                contactInfo = loadContactInfo(phoneNumber);
            }
        }
        
        // If custom message provided, override the standard voicemail
        if (message) {
            // Create a custom TwiML
            const twiml = new VoiceResponse();
            twiml.pause({ length: 2 });
            
            const greeting = customGreeting || (contactInfo?.fullname ? 
                `Hello ${contactInfo.fullname}` : 'Hello');
                
            const ending = customEnding || 
                `Please call us back at your earliest convenience at ${process.env.FROM_NUMBER}. Thank you and have a great day.`;
            
            // Construct the full message
            const fullMessage = `${greeting}. ${message} ${ending}`;
            
            twiml.say({
                voice: 'Polly.Joanna',
                language: 'en-US',
                rate: '0.9'
            }, fullMessage);
            
            twiml.pause({ length: 1 });
            
            // Send custom voicemail
            const call = await client.calls.create({
                twiml: twiml.toString(),
                to: phoneNumber,
                from: process.env.FROM_NUMBER,
                record: true,
                timeout: 30,
                sendDigits: '1',
                machineDetection: 'DetectMessageEnd',
                method: 'POST',
                statusCallback: `https://${process.env.SERVER}/api/voicemail-status-direct`,
                statusCallbackEvent: ['completed'],
                statusCallbackMethod: 'POST'
            });
            
            res.json({
                success: true,
                message: `Direct voicemail initiated with SID: ${call.sid}`,
                voicemailSid: call.sid
            });
        } else {
            // Use standard voicemail
            const voicemailSid = await leaveVoicemail(phoneNumber, contactInfo, client);
            
            if (voicemailSid) {
                res.json({
                    success: true,
                    message: `Voicemail initiated with SID: ${voicemailSid}`,
                    voicemailSid
                });
            } else {
                res.status(500).json({
                    success: false,
                    message: 'Failed to initiate voicemail'
                });
            }
        }
    } catch (error) {
        console.error('Error in direct voicemail endpoint:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error',
            error: error.message
        });
    }
});

// Status webhook for direct voicemails
router.post('/status-direct', async (req, res) => {
    try {
        console.log('Received direct voicemail status update:', req.body);
        
        const {
            CallSid: callSid,
            CallStatus: callStatus,
            RecordingUrl: recordingUrl,
            RecordingSid: recordingSid
        } = req.body;
        
        if (callSid) {
            // Create a status entry for this direct voicemail
            const status = {
                id: Date.now(),
                type: 'direct-voicemail',
                callSid,
                status: callStatus,
                timestamp: new Date().toISOString(),
                recordingUrl,
                recordingSid
            };
            
            // Save to voicemail directory
            const voicemailDir = path.join(__dirname, '..', 'voicemails');
            if (!fs.existsSync(voicemailDir)) {
                fs.mkdirSync(voicemailDir);
            }
            
            fs.writeFileSync(
                path.join(voicemailDir, `${callSid}.json`),
                JSON.stringify(status, null, 2),
                'utf8'
            );
        }
        
        res.status(200).send('OK');
    } catch (error) {
        console.error('Error processing direct voicemail status update:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Get all voicemails
router.get('/list', (req, res) => {
    try {
        const voicemailDir = path.join(__dirname, '..', 'voicemails');
        if (!fs.existsSync(voicemailDir)) {
            fs.mkdirSync(voicemailDir);
        }
        
        const voicemails = [];
        fs.readdirSync(voicemailDir).forEach(file => {
            if (file.endsWith('.json')) {
                try {
                    const vm = JSON.parse(fs.readFileSync(path.join(voicemailDir, file), 'utf8'));
                    voicemails.push(vm);
                } catch (err) {
                    // Skip invalid files
                }
            }
        });
        
        res.json({
            success: true,
            data: voicemails
        });
    } catch (error) {
        console.error('Error listing voicemails:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to list voicemails',
            error: error.message
        });
    }
});

// Endpoint for carrier-specific direct voicemail
router.post('/direct-vm', async (req, res) => {
    try {
        const { phoneNumber, message } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({
                success: false,
                message: 'Phone number is required'
            });
        }
        
        console.log(`Attempting direct carrier VM for ${phoneNumber}`);
        
        // For US/Canada carriers, this approach may work better
        // First call to trigger busy/rejection
        const rejectTwiml = new VoiceResponse();
        rejectTwiml.reject({ reason: 'busy' });
        
        const busyCall = await client.calls.create({
            twiml: rejectTwiml.toString(),
            to: phoneNumber,
            from: process.env.FROM_NUMBER,
            method: 'POST'
        });
        
        console.log(`Busy call initiated with SID: ${busyCall.sid}`);
        
        // Wait for voicemail to be ready
        await new Promise(resolve => setTimeout(resolve, 4000));
        
        // Create voicemail message
        const vmTwiml = new VoiceResponse();
        vmTwiml.pause({ length: 3 });
        
        // Try to skip voicemail greeting with # and *
        vmTwiml.play({ digits: '##' });
        vmTwiml.pause({ length: 1 });
        
        const vmMessage = message || "This is an important message. We tried to reach you but were unable to connect. Please call us back at your earliest convenience.";
        
        vmTwiml.say({
            voice: 'Polly.Joanna',
            language: 'en-US',
            rate: '0.8'
        }, vmMessage);
        
        vmTwiml.pause({ length: 1 });
        vmTwiml.say({
            voice: 'Polly.Joanna',
            language: 'en-US',
            rate: '0.7'
        }, `Our number is ${process.env.FROM_NUMBER.split('').join(' ')}. Thank you.`);
        
        // Make the voicemail call
        const vmCall = await client.calls.create({
            twiml: vmTwiml.toString(),
            to: phoneNumber,
            from: process.env.FROM_NUMBER,
            record: true,
            timeout: 60,
            machineDetection: 'Enable',
            asyncAmd: 'true',
            asyncAmdStatusCallback: `https://${process.env.SERVER}/api/voicemail/amd-status`,
            statusCallback: `https://${process.env.SERVER}/api/voicemail/status-carrier`,
            statusCallbackEvent: ['completed'],
            statusCallbackMethod: 'POST'
        });
        
        res.json({
            success: true,
            message: `Direct carrier voicemail initiated`,
            busyCallSid: busyCall.sid,
            voicemailSid: vmCall.sid
        });
    } catch (error) {
        console.error('Error in direct carrier voicemail endpoint:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error',
            error: error.message
        });
    }
});

// AMD status callback
router.post('/amd-status', (req, res) => {
    console.log('AMD Status:', req.body);
    res.status(200).send('OK');
});

// Status callback for carrier-specific voicemail
router.post('/status-carrier', (req, res) => {
    console.log('Carrier Voicemail Status:', req.body);
    res.status(200).send('OK');
});

// Endpoint for SMS voicemail alternative
router.post('/sms-vm', async (req, res) => {
    try {
        const { phoneNumber, message } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({
                success: false,
                message: 'Phone number is required'
            });
        }

        // Create a standard message if none provided
        const smsMessage = message || 
            "Hello, we tried to reach you but couldn't connect. Please call us back at " + 
            process.env.FROM_NUMBER + " at your earliest convenience. Thank you.";
        
        // Send SMS as voicemail alternative
        const sms = await client.messages.create({
            body: smsMessage,
            from: process.env.FROM_NUMBER,
            to: phoneNumber
        });
        
        console.log(`SMS voicemail alternative sent with SID: ${sms.sid}`);
        
        res.json({
            success: true,
            message: `SMS voicemail alternative sent`,
            smsSid: sms.sid
        });
    } catch (error) {
        console.error('Error sending SMS voicemail alternative:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send SMS',
            error: error.message
        });
    }
});

module.exports = router; 