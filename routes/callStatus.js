const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const { leaveVoicemail, loadContactInfo } = require('../services/voicemail-service');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

// 파일 기반 저장소 설정
const STATUS_DIR = path.join(__dirname, '..', 'call-statuses');
if (!fs.existsSync(STATUS_DIR)) {
    fs.mkdirSync(STATUS_DIR);
}


const saveCallStatus = (callSid, status) => {
    const filePath = path.join(STATUS_DIR, `${callSid}.json`);
    fs.writeFileSync(filePath, JSON.stringify(status, null, 2), 'utf8');
};


const loadCallStatus = (callSid) => {
    const filePath = path.join(STATUS_DIR, `${callSid}.json`);
    if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    return null;
};


const loadAllCallStatuses = () => {
    const statuses = {};
    if (fs.existsSync(STATUS_DIR)) {
        fs.readdirSync(STATUS_DIR).forEach(file => {
            if (file.endsWith('.json')) {
                const callSid = file.replace('.json', '');
                statuses[callSid] = loadCallStatus(callSid);
            }
        });
    }
    return statuses;
};



router.post('/call-status', async (req, res) => {
    try {
        console.log('Received request headers:', req.headers);
        console.log('Raw request body:', req.body);
        console.log('Received request query:', req.query);
        console.log('Received request params:', req.params);

        // Get callSid from either query parameters or request body
        const callSid = req.query.callSid || req.body.CallSid;
        
        if (!callSid) {
            console.error('No CallSid provided in callback');
            return res.status(400).send('Missing CallSid');
        }

        const {
            CallStatus: callStatus,
            CallDuration: callDuration,
            To: to,
            From: from,
            Direction: direction,
            ParentCallSid: parentCallSid
        } = req.body;

        console.log('Processing call status update for SID:', callSid, 'with status:', callStatus);


        const statusMap = {
            'initiated': 'pending',
            'queued': 'pending',
            'ringing': 'in-progress',
            'in-progress': 'in-progress',
            'completed': 'completed',
            'busy': 'failed',
            'no-answer': 'failed',
            'failed': 'failed',
            'canceled': 'failed'
        };

        const mappedStatus = statusMap[callStatus] || 'failed';

        const currentStatus = loadCallStatus(callSid) || {
            id: Date.now(),
            clientName: 'Unknown',
            phone: to || 'Unknown',
            status: 'pending',
            timestamp: new Date().toISOString()
        };

        const updatedStatus = {
            ...currentStatus,
            status: mappedStatus,
            duration: callDuration || 0,
            timestamp: new Date().toISOString(),
            direction: direction || 'outbound',
            parentCallSid: parentCallSid || null,
            lastUpdate: {
                status: callStatus,
                timestamp: new Date().toISOString(),
                errorCode: req.body.ErrorCode,
                errorMessage: req.body.ErrorMessage,
                sipResponseCode: req.body.SipResponseCode
            }
        };

        // Check if the call was not answered and attempt to leave voicemail
        if (callStatus === 'no-answer' || callStatus === 'busy') {
            // Get the contact information for this phone number
            try {
                const phoneNumber = to;
                
                // Leave voicemail using our service
                const voicemailSid = await leaveVoicemail(phoneNumber, client);
                
                if (voicemailSid) {
                    // Update the status to include voicemail information
                    updatedStatus.voicemail = {
                        sid: voicemailSid,
                        timestamp: new Date().toISOString(),
                        status: 'initiated'
                    };
                    
                    console.log(`Voicemail initiated for call ${callSid} with voicemail SID ${voicemailSid}`);
                }
            } catch (vmError) {
                console.error('Error processing voicemail:', vmError);
            }
        }

        saveCallStatus(callSid, updatedStatus);

        console.log('Call Status Update:', {
            callSid,
            originalStatus: callStatus,
            mappedStatus: mappedStatus,
            duration: callDuration,
            to,
            from,
            direction,
            errorCode: req.body.ErrorCode,
            errorMessage: req.body.ErrorMessage,
            sipResponseCode: req.body.SipResponseCode
        });

        res.status(200).send('OK');
    } catch (error) {
        console.error('Error processing call status update:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Endpoint to handle voicemail status updates
router.post('/voicemail-status', async (req, res) => {
    try {
        console.log('Received voicemail status update:', req.body);
        
        const {
            CallSid: callSid,
            CallStatus: callStatus,
            RecordingUrl: recordingUrl,
            RecordingSid: recordingSid,
            To: phoneNumber
        } = req.body;
        
        if (callSid) {
            // Check if this voicemail is associated with a previous call
            const allStatuses = loadAllCallStatuses();
            
            for (const [originalCallSid, status] of Object.entries(allStatuses)) {
                if (status.voicemail && status.voicemail.sid === callSid) {
                    // Update the original call's status with voicemail information
                    status.voicemail.status = callStatus;
                    
                    if (recordingUrl) {
                        status.voicemail.recordingUrl = recordingUrl;
                    }
                    
                    if (recordingSid) {
                        status.voicemail.recordingSid = recordingSid;
                    }
                    
                    saveCallStatus(originalCallSid, status);
                    console.log(`Updated original call ${originalCallSid} with voicemail status: ${callStatus}`);
                    
                    // If voicemail failed, try sending an SMS as fallback
                    if (callStatus === 'failed' && phoneNumber) {
                        try {
                            const contactInfo = loadContactInfo(phoneNumber);
                            const name = contactInfo?.fullname || '';
                            const smsMessage = `Hello${name ? ' ' + name : ''}, we tried to reach you but couldn't connect. Please call us back at ${process.env.FROM_NUMBER} at your earliest convenience. Thank you.`;
                            
                            const sms = await client.messages.create({
                                body: smsMessage,
                                from: process.env.FROM_NUMBER,
                                to: phoneNumber
                            });
                            
                            console.log(`SMS fallback sent with SID: ${sms.sid} for call ${originalCallSid}`);
                            
                            // Update status with SMS information
                            status.smsFallback = {
                                sid: sms.sid,
                                timestamp: new Date().toISOString(),
                                status: 'sent'
                            };
                            
                            saveCallStatus(originalCallSid, status);
                        } catch (smsError) {
                            console.error('Error sending SMS fallback:', smsError);
                        }
                    }
                    
                    break;
                }
            }
        }
        
        res.status(200).send('OK');
    } catch (error) {
        console.error('Error processing voicemail status update:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.get('/call-status/:callSid', (req, res) => {
    try {
        const callSid = req.params.callSid;
        const callStatus = loadCallStatus(callSid);

        if (callStatus) {
            res.json({
                success: true,
                data: callStatus
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Call status not found'
            });
        }
    } catch (error) {
        console.error('Error retrieving call status:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
});

router.get('/call-statuses', (req, res) => {
    try {
        const allStatuses = loadAllCallStatuses();
        const statusesArray = Object.entries(allStatuses).map(([callSid, status]) => ({
            callSid,
            ...status
        }));

        res.json({
            success: true,
            data: statusesArray
        });
    } catch (error) {
        console.error('Error retrieving all call statuses:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
});

// Test endpoint to send a voicemail directly
router.post('/test-voicemail', async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({
                success: false,
                message: 'Phone number is required'
            });
        }
        
        // Load contact info
        const contactInfo = loadContactInfo(phoneNumber);
        
        // Leave voicemail
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
    } catch (error) {
        console.error('Error in test voicemail endpoint:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error',
            error: error.message
        });
    }
});

module.exports = router; 