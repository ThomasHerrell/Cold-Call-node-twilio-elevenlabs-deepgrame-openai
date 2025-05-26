const VoiceResponse = require('twilio').twiml.VoiceResponse;
const fs = require('fs');
const path = require('path');

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
    twiml.say({
        voice: 'Polly.Joanna',
        language: 'en-US',
        rate: '0.7'
    }, `Again, our number is ${process.env.FROM_NUMBER.split('').join(' ')}. Thank you.`);
    
    // Add final pause to ensure the voicemail system captures everything
    twiml.pause({ length: 2 });

    return twiml.toString();
};

/**
 * Leaves a voicemail for a phone number using the provided contact information
 * @param {string} phoneNumber - The phone number to leave a voicemail for
 * @param {Object} twilioClient - Twilio client instance
 * @returns {Promise<string|null>} - The SID of the voicemail call or null if failed
 */
const leaveVoicemail = async (phoneNumber, twilioClient) => {
    try {
        console.log(`Attempting to leave voicemail for ${phoneNumber}`);
        
        // Try to load contact info but don't require it
        let contactInfo = null;
        try {
            contactInfo = loadContactInfo(phoneNumber);
        } catch (error) {
            console.log(`Could not load contact info for ${phoneNumber}, using default message`);
        }
        
        // Generate TwiML for voicemail
        const messageContent = generateVoicemailTwiML(contactInfo);
        
        // Create a direct-to-voicemail TwiML
        const twiml = new VoiceResponse();
        
        // Add a <Reject> with reason="busy" to immediately reject the call but send it to voicemail
        twiml.reject({ reason: 'busy' });
        
        // First make a call that will be rejected to trigger voicemail
        const initialCall = await twilioClient.calls.create({
            twiml: twiml.toString(),
            to: phoneNumber,
            from: process.env.FROM_NUMBER,
            method: 'POST'
        });
        
        console.log(`Initial call to trigger voicemail: ${initialCall.sid}`);
        
        // Wait 3 seconds to allow voicemail to pick up
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Now make the actual voicemail call
        const voicemailCall = await twilioClient.calls.create({
            twiml: messageContent,
            to: phoneNumber,
            from: process.env.FROM_NUMBER,
            record: true,
            timeout: 45, // Longer timeout
            sendDigits: '#1', // Send digits to navigate voicemail system
            method: 'POST',
            statusCallback: `https://${process.env.SERVER}/api/voicemail-status`,
            statusCallbackEvent: ['completed'],
            statusCallbackMethod: 'POST'
        });
        
        console.log(`Voicemail call initiated with SID: ${voicemailCall.sid}`);
        return voicemailCall.sid;
    } catch (error) {
        console.error('Error leaving voicemail:', error);
        return null;
    }
};

/**
 * Load contact information from file
 * @param {string} phoneNumber - Phone number to get contact info for
 * @returns {Object|null} - Contact information or null if not found
 */


module.exports = {
    leaveVoicemail,
    generateVoicemailTwiML,
}; 