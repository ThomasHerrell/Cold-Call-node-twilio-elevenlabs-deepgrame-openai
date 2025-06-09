const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const { db } = require('../firebase/firebaseConfig');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const { leaveVoicemail, loadContactInfo } = require('../services/voicemail-service');
const { collection, doc, setDoc, getDoc, getDocs } = require('firebase/firestore');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

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

// Save call status to Firestore
const saveCallStatus = async (callSid, status) => {
    try {
        const cleanedStatus = cleanUndefinedValues(status);
        const callRef = doc(db, 'callStatuses', callSid);
        await setDoc(callRef, cleanedStatus, { merge: true });
    } catch (error) {
        console.error('Error saving call status to Firestore:', error);
        throw error;
    }
};

// Load call status from Firestore
const loadCallStatus = async (callSid) => {
    try {
        const callRef = doc(db, 'callStatuses', callSid);
        const docSnap = await getDoc(callRef);
        return docSnap.exists() ? docSnap.data() : null;
    } catch (error) {
        console.error('Error loading call status from Firestore:', error);
        return null;
    }
};

// Load all call statuses from Firestore
const loadAllCallStatuses = async () => {
    try {
        const callStatusesRef = collection(db, 'callStatuses');
        const snapshot = await getDocs(callStatusesRef);
        const statuses = {};
        snapshot.forEach(doc => {
            statuses[doc.id] = doc.data();
        });
        return statuses;
    } catch (error) {
        console.error('Error loading all call statuses from Firestore:', error);
        return {};
    }
};

router.post('/call-status', async (req, res) => {
    try {
        console.log('Received request headers:', req.headers);
        console.log('Raw request body:', req.body);
        console.log('Received request query:', req.query);
        console.log('Received request params:', req.params);

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

        // Define detailed status mapping
        const statusDetails = {
            'initiated': {
                status: 'initiated',
                description: 'Call has been initiated',
                category: 'in-progress'
            },
            'queued': {
                status: 'queued',
                description: 'Call is queued',
                category: 'in-progress'
            },
            'ringing': {
                status: 'ringing',
                description: 'Phone is ringing',
                category: 'in-progress'
            },
            'in-progress': {
                status: 'in-progress',
                description: 'Call is in progress',
                category: 'in-progress'
            },
            'completed': {
                status: 'completed',
                description: 'Call completed successfully',
                category: 'completed'
            },
            'busy': {
                status: 'busy',
                description: 'Recipient phone was busy',
                category: 'failed'
            },
            'no-answer': {
                status: 'no-answer',
                description: 'No answer from recipient',
                category: 'failed'
            },
            'failed': {
                status: 'failed',
                description: 'Call failed',
                category: 'failed'
            },
            'canceled': {
                status: 'canceled',
                description: 'Call was canceled',
                category: 'failed'
            }
        };

        const currentStatus = await loadCallStatus(callSid) || {
            id: Date.now(),
            clientName: 'Unknown',
            phone: to || 'Unknown',
            status: 'initiated',
            statusHistory: [],
            timestamp: new Date().toISOString()
        };

        // Ensure statusHistory is an array
        if (!Array.isArray(currentStatus.statusHistory)) {
            currentStatus.statusHistory = [];
        }

        const statusDetail = statusDetails[callStatus] || {
            status: callStatus,
            description: 'Unknown status',
            category: 'unknown'
        };

        // Create status history entry
        const statusHistoryEntry = {
            timestamp: new Date().toISOString(),
            status: callStatus,
            details: statusDetail,
            duration: callDuration || 0,
            errorCode: req.body.ErrorCode || null,
            errorMessage: req.body.ErrorMessage || null,
            sipResponseCode: req.body.SipResponseCode || null
        };

        // Update the status object
        const updatedStatus = {
            ...currentStatus,
            status: statusDetail.status,
            statusCategory: statusDetail.category,
            statusDescription: statusDetail.description,
            duration: callDuration || 0,
            timestamp: new Date().toISOString(),
            direction: direction || 'outbound',
            parentCallSid: parentCallSid || null,
            lastUpdate: statusHistoryEntry,
            // Add new status to history array
            statusHistory: [...currentStatus.statusHistory, statusHistoryEntry]
        };

        // Handle voicemail for failed calls
        if (['busy', 'no-answer', 'failed', 'canceled'].includes(callStatus)) {
            try {
                const phoneNumber = to;
                const voicemailSid = await leaveVoicemail(phoneNumber, client);
                
                if (voicemailSid) {
                    const voicemailStatus = {
                        sid: voicemailSid,
                        timestamp: new Date().toISOString(),
                        status: 'initiated'
                    };
                    
                    updatedStatus.voicemail = voicemailStatus;
                    updatedStatus.statusHistory.push({
                        ...statusHistoryEntry,
                        voicemail: voicemailStatus
                    });
                    
                    console.log(`Voicemail initiated for call ${callSid} with voicemail SID ${voicemailSid}`);
                }
            } catch (vmError) {
                console.error('Error processing voicemail:', vmError);
                updatedStatus.statusHistory.push({
                    timestamp: new Date().toISOString(),
                    status: 'voicemail-failed',
                    error: vmError.message
                });
            }
        }

        await saveCallStatus(callSid, updatedStatus);

        console.log('Call Status Update:', {
            callSid,
            originalStatus: callStatus,
            currentStatus: statusDetail,
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
            const allStatuses = await loadAllCallStatuses();
            
            for (const [originalCallSid, status] of Object.entries(allStatuses)) {
                if (status.voicemail && status.voicemail.sid === callSid) {
                    status.voicemail.status = callStatus;
                    
                    if (recordingUrl) {
                        status.voicemail.recordingUrl = recordingUrl;
                    }
                    
                    if (recordingSid) {
                        status.voicemail.recordingSid = recordingSid;
                    }
                    
                    await saveCallStatus(originalCallSid, status);
                    console.log(`Updated original call ${originalCallSid} with voicemail status: ${callStatus}`);
                    
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
                            
                            status.smsFallback = {
                                sid: sms.sid,
                                timestamp: new Date().toISOString(),
                                status: 'sent'
                            };
                            
                            await saveCallStatus(originalCallSid, status);
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

router.post('/call-status/:callSid', async (req, res) => {
    try {
        const callSid = req.params.callSid;
        const callStatus = await loadCallStatus(callSid);

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

router.get('/call-statuses', async (req, res) => {
    try {
        const allStatuses = await loadAllCallStatuses();
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

router.post('/test-voicemail', async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({
                success: false,
                message: 'Phone number is required'
            });
        }
        
        const contactInfo = loadContactInfo(phoneNumber);
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