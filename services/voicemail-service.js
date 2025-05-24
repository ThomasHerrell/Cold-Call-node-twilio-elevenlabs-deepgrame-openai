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
    
    // Send pound key to skip voicemail greeting on some systems
    twiml.play({ digits: '#' });
    
    // Add another pause
    twiml.pause({ length: 1 });
    
    // Get contact name or use generic greeting
    const greeting = contactInfo?.fullname ? `Hello ${contactInfo.fullname}` : 'Hello';
    
    // Get company name or use default
    const company = contactInfo?.company || 'our company';

    // Get AI agent name if available
    const aiName = contactInfo?.ai_profile_name || '';

    // Customize message based on available contact information
    let message = `${greeting}, this is ${aiName} from ${company}. `;
    message += 'We tried to reach you earlier but were unable to connect. ';
    
    // Add customized content if available
    if (contactInfo?.content) {
        // Extract a brief summary from content (first 100 characters)
        const summary = contactInfo.content.substring(0, 100) + '...';
        message += `I wanted to discuss ${summary} `;
    }
    
    message += `Please call us back at your earliest convenience at ${process.env.FROM_NUMBER} to discuss further. `;
    message += 'Thank you and have a great day.';

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
 * @param {Object} contactInfo - Contact information for customization
 * @param {Object} twilioClient - Twilio client instance
 * @returns {Promise<string|null>} - The SID of the voicemail call or null if failed
 */
const leaveVoicemail = async (phoneNumber, contactInfo, twilioClient) => {
    try {
        console.log(`Attempting to leave voicemail for ${phoneNumber}`);
        
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
const loadContactInfo = (phoneNumber) => {
    try {
        // Normalize phone number to remove any formatting
        const normalizedPhone = phoneNumber.replace(/\D/g, '');
        
        // Search for contact file with this phone number
        const scriptsDir = path.join(__dirname, '..', 'scripts');
        
        if (fs.existsSync(scriptsDir)) {
            // Try exact match first
            const exactFilePath = path.join(scriptsDir, `${phoneNumber}.txt`);
            if (fs.existsSync(exactFilePath)) {
                return JSON.parse(fs.readFileSync(exactFilePath, 'utf8'));
            }
            
            // Try normalized phone number
            const normalizedFilePath = path.join(scriptsDir, `${normalizedPhone}.txt`);
            if (fs.existsSync(normalizedFilePath)) {
                return JSON.parse(fs.readFileSync(normalizedFilePath, 'utf8'));
            }
            
            // Try to find by matching the last digits if no exact match
            const files = fs.readdirSync(scriptsDir);
            for (const file of files) {
                if (file.endsWith('.txt') && !file.includes('_')) {
                    const filePhone = file.replace('.txt', '');
                    const normalizedFilePhone = filePhone.replace(/\D/g, '');
                    
                    // Match if last 8 digits are the same
                    if (normalizedFilePhone.length >= 8 && 
                        normalizedPhone.length >= 8 &&
                        normalizedFilePhone.slice(-8) === normalizedPhone.slice(-8)) {
                        return JSON.parse(fs.readFileSync(path.join(scriptsDir, file), 'utf8'));
                    }
                }
            }
        }
        
        return null;
    } catch (error) {
        console.error('Error loading contact information:', error);
        return null;
    }
};

module.exports = {
    leaveVoicemail,
    generateVoicemailTwiML,
    loadContactInfo
}; 