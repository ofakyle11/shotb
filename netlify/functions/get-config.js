// netlify/functions/get-config.js
// Public configuration endpoint (safe to expose to browser)
// Returns only non-secret Firebase web config + any other public settings.

'use strict';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  // Only expose the public Firebase web config
  // (these values are already in the client anyway via js/config.js)
  const publicConfig = {
    firebase: {
      apiKey: "AIzaSyA5-NRXzzkWuGafQ5-EukGF9WMnQ2txFFA",
      authDomain: "shotbreak-9f342.firebaseapp.com",
      projectId: "shotbreak-9f342",
      storageBucket: "shotbreak-9f342.firebasestorage.app",
      messagingSenderId: "515766987392",
      appId: "1:515766987392:web:ac3644d952c69d11c7d465"
    },
    // Add any other truly public settings here in the future
    version: "v91-max-power"
  };

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify(publicConfig)
  };
};
