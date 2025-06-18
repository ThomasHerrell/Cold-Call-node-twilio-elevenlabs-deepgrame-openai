const VoiceResponse = require('twilio').twiml.VoiceResponse;
const fs = require('fs');
const path = require('path');

/**
 * Load contact information from file or database
 * @param {string} phoneNumber - Phone number to get contact info for
 * @returns {Object|null} - Contact information or null if not found
 */
const loadContactInfo = (phoneNumber) => {
    try {
        // Try to load from contacts file if it exists
        const contactsPath = path.join(__dirname, '../data/contacts.json');
        if (fs.existsSync(contactsPath)) {
            const contactsData = fs.readFileSync(contactsPath, 'utf8');
            const contacts = JSON.parse(contactsData);
            return contacts[phoneNumber] || null;
        }
        
        // If no contacts file, return basic info
        return {
            fullname: '',
            phone: phoneNumber,
            email: ''
        };
    } catch (error) {
        console.log(`Could not load contact info for ${phoneNumber}:`, error.message);
        return {
            fullname: '',
            phone: phoneNumber,
            email: ''
        };
    }
};

/**
 * Generate a customized voicemail TwiML response based on contact information
 * @param {Object} contactInfo - Contact information object
 * @returns {string} - TwiML response as string
 */
const generateVoicemailTwiML = (contactInfo) => {
    const twiml = new VoiceResponse();
    
    // Add a longer initial pause to wait for voicemail system to be ready
    twiml.pause({ length: 3 });
    
    // Customize message based on available contact information
    let message = `Hello, this is a final notice regarding your documents requiring your signature. `;
    message += 'We have made two delivery attempts, and your urgent action is needed. ';

    // Create the TwiML response with slower rate and lower pitch for better voicemail capture
    twiml.say({
        voice: 'Polly.Joanna', // Use Amazon Polly voice or other available voice
        language: 'en-US',
        rate: '0.8', // Even slower speech rate
        pitch: '-2%'  // Slightly lower pitch
    }, message);
    
    // Repeat the callback number to ensure it's captured
    twiml.pause({ length: 1 });
    
    // Safely handle FROM_NUMBER with fallback
    const fromNumber = '+15594842326'

    
    twiml.say({
        voice: 'Polly.Joanna',
        language: 'en-US',
        rate: '0.7'
    }, `Again, our number is ${fromNumber}. Thank you.`);
    
    // Add final pause to ensure the voicemail system captures everything
    twiml.pause({ length: 2 });

    return twiml.toString();
};

/**
 * Generate voice email TwiML for busy/no-answer scenarios
 * @param {Object} contactInfo - Contact information object
 * @returns {string} - TwiML response as string
 */
const generateVoiceEmailTwiML = (contactInfo) => {
    const twiml = new VoiceResponse();
    
    // Add initial pause for voicemail system
    twiml.pause({ length: 2 });
    
    // Voice email message
    let message = `Hello${contactInfo?.fullname ? ' ' + contactInfo.fullname : ''}, `;
    message += 'this is an important voice email regarding your account. ';
    message += 'We attempted to reach you but were unable to connect. ';
    message += 'Please call us back at your earliest convenience at ';
    
    // Safely handle FROM_NUMBER with fallback
    const fromNumber = '+15594842326'
    message += `${fromNumber}. `;
    message += 'Thank you for your attention to this matter.';

    twiml.say({
        voice: 'Polly.Joanna',
        language: 'en-US',
        rate: '0.8',
        pitch: '-2%'
    }, message);
    
    // Add final pause
    twiml.pause({ length: 1 });

    return twiml.toString();
};

/**
 * Leaves a voicemail for a phone number using the provided contact information
 * @param {string} phoneNumber - The phone number to leave a voicemail for
 * @param {Object} twilioClient - Twilio client instance
 * @param {string} type - Type of message: 'voicemail' or 'voice-email'
 * @returns {Promise<string|null>} - The SID of the voicemail call or null if failed
 */
const leaveVoicemail = async (phoneNumber, twilioClient, type = 'voicemail') => {
    try {
        console.log(`Attempting to leave ${type} for ${phoneNumber}`);
        
        // Check if FROM_NUMBER is available
        if (!process.env.FROM_NUMBER) {
            console.error('FROM_NUMBER environment variable is not set');
            return null;
        }
        
        // Try to load contact info but don't require it
        let contactInfo = null;
        try {
            contactInfo = loadContactInfo(phoneNumber);
        } catch (error) {
            console.log(`Could not load contact info for ${phoneNumber}, using default message`);
        }
        
        // Generate appropriate TwiML based on type
        let messageContent;
        if (type === 'voice-email') {
            messageContent = generateVoiceEmailTwiML(contactInfo);
        } else {
            messageContent = generateVoicemailTwiML(contactInfo);
        }
        
        // Make the voicemail/voice-email call
        const voicemailCall = await twilioClient.calls.create({
            twiml: messageContent,
            to: phoneNumber,
            from: process.env.FROM_NUMBER,
            record: true,
            timeout: 30,
            sendDigits: '#1', // Send digits to navigate voicemail system
            method: 'POST',
            statusCallback: `https://${process.env.SERVER}/api/voicemail-status`,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed', 'busy', 'no-answer', 'failed'],
            statusCallbackMethod: 'POST'
        });
        
        console.log(`${type} call initiated with SID: ${voicemailCall.sid}`);
        return voicemailCall.sid;
    } catch (error) {
        console.error(`Error leaving ${type}:`, error);
        return null;
    }
};

/**
 * Send voice email for busy/no-answer scenarios
 * @param {string} phoneNumber - The phone number to send voice email to
 * @param {Object} twilioClient - Twilio client instance
 * @returns {Promise<string|null>} - The SID of the voice email call or null if failed
 */
const sendVoiceEmail = async (phoneNumber, twilioClient) => {
    return await leaveVoicemail(phoneNumber, twilioClient, 'voice-email');
};

module.exports = {
    leaveVoicemail,
    sendVoiceEmail,
    generateVoicemailTwiML,
    generateVoiceEmailTwiML,
    loadContactInfo
}; 