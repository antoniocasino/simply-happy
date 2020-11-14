/*
 * Copyright 2018 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the
 * License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing permissions and
 * limitations under the License.
 */

const express = require('express');
const cookieParser = require('cookie-parser')
const app = express();
const admin = require('firebase-admin');
const bodyParser = require('body-parser');

/**
 * Renders the profile page and serves it in the response.
 * @param {string} endpoint The get profile endpoint.
 * @param {!Object} req The expressjs request.
 * @param {!Object} res The expressjs response.
 * @param {!admin.auth.DecodedIdToken} decodedClaims The decoded claims from verified
 *     session cookies.
 * @return {!Promise} A promise that resolves on success.
 */
function serveContentForUser(endpoint, req, res, decodedClaims) {
    // Lookup the user information corresponding to cookie and return the profile data for the user.
    return admin.auth().getUser(decodedClaims.sub).then(function (userRecord) {

        // initialize user tips
        updateDayTip("user_tips", userRecord.uid, 0,res);

        const html = '<!DOCTYPE html>' +
            '<html>' +
            '<meta charset="UTF-8">' +
            '<link href="style.css" rel="stylesheet" type="text/css" media="screen" />' +
            '<meta name="viewport" content="width=device-width, initial-scale=1">' +
            '<title>Sample Profile Page</title>' +
            '<body>' +
            '<div id="container">' +
            '  <h3>Welcome to Session Management Example App, ' + (userRecord.displayName || 'N/A') + '</h3>' +
            '  <div id="loaded">' +
            '    <div id="main">' +
            '      <div id="user-signed-in">' +
            // Show user profile information.
            '        <div id="user-info">' +
            '          <div id="photo-container">' +
            (userRecord.photoURL ? '      <img id="photo" src=' + userRecord.photoURL + '>' : '') +
            '          </div>' +
            '          <div id="name">' + userRecord.displayName + '</div>' +
            '          <div id="email">' +
            userRecord.email + ' (' + (userRecord.emailVerified ? 'verified' : 'unverified') + ')</div>' +
            '          <div class="clearfix"></div>' +
            '        </div>' +
            '       <div>  <a href="tips/' + userRecord.uid + '">display actions of the day</a></div>' +
            '       <div>  <a href="complete_tip/' + userRecord.uid + '">complete tip of the day</a></div>' +
            '       <p>' +
            // Append button for sign out.
            '          <button id="sign-out" onClick="window.location.assign(\'/logout\')">Sign Out</button>' +
            // Append button for deletion.
            '          <button id="delete-account" onClick="window.location.assign(\'/delete\')">' +
            'Delete account</button>' +
            '        </p>' +
            '      </div>' +
            '    </div>' +
            '  </div>' +
            '</div>' +
            '</body>' +
            '</html>';
        res.set('Content-Type', 'text/html');
        res.end(html);
    });
}

/**
 * Attaches a CSRF token to the request.
 * @param {string} url The URL to check.
 * @param {string} cookie The CSRF token name.
 * @param {string} value The CSRF token value to save.
 * @return {function} The middleware function to run.
 */
function attachCsrfToken(url, cookie, value) {
    return function (req, res, next) {
        if (req.url == url) {
            res.cookie(cookie, value);
        }
        next();
    }
}

/**
 * Checks if a user is signed in and if so, redirects to profile page.
 * @param {string} url The URL to check if signed in.
 * @return {function} The middleware function to run.
 */
function checkIfSignedIn(url) {
    return function (req, res, next) {
        if (req.url == url) {
            const sessionCookie = req.cookies.session || '';
            // User already logged in. Redirect to profile page.
            admin.auth().verifySessionCookie(sessionCookie).then(function (decodedClaims) {
                res.redirect('/profile');
            }).catch(function (error) {
                next();
            });
        } else {
            next();
        }
    }
}

// Initialize Admin SDK.
admin.initializeApp({
    credential: admin.credential.cert('serviceAccountKeys.json'),
    databaseURL: 'https://simply-happy-e392e.firebaseio.com'
});
// Support JSON-encoded bodies.
app.use(bodyParser.json());
// Support URL-encoded bodies.
app.use(bodyParser.urlencoded({
    extended: true
}));
// Support cookie manipulation.
app.use(cookieParser());
// Attach CSRF token on each request.
app.use(attachCsrfToken('/', 'csrfToken', (Math.random() * 100000000000000000).toString()));
// If a user is signed in, redirect to profile page.
app.use(checkIfSignedIn('/',));
// Serve static content from public folder.
app.use('/', express.static('public'));

/** get tips endpoint **/
app.get('/tips/:id', function (req, res) {
    const userId = req.path.split("tips/")[1];
    return admin.auth().getUser(userId).then(function (userRecord) {
        console.log(userRecord.displayName + " user id is: " + userId);
        let tips = "hello " + userRecord.displayName + ': The tips of the day are: ';
        const db = admin.firestore();
        const userTipsRef = db.collection("user_tips").doc(userId);
        userTipsRef.get().then(userTipsData => {
            let day = 1;
            if (userTipsData && userTipsData.protoField("day") && userTipsData.protoField("day").integerValue) {
                day = parseInt(userTipsData.protoField("day").integerValue);
            }
            /*console.log(userTipsData);*/
            const tipsRef = db.collection("tips").doc(day.toString());
            tipsRef.get().then(tipsData => {
                tips += tipsData.protoField("tips").stringValue;
                /*console.log("tipsData", tipsData.protoField("tips"));*/
                res.end(JSON.stringify({tips: tips}));
            })
        });
    });
});

/** complete tip endpoint **/
app.get('/complete_tip/:id', function (req, res) {
    const userId = req.path.split("complete_tip/")[1];
    console.log("userId-complete",userId);
    updateDayTip("user_tips", userId, 1,res);
});


function updateDayTip(table, userId, dayIncrement,response) {
    const db = admin.firestore();
    const tableRef = db.collection(table).doc(userId);

    tableRef.get().then(data => {
        let day = 1;
        if (data && data.protoField("day") && data.protoField("day").integerValue) {
            day = parseInt(data.protoField("day").integerValue);
        }
        const result = tableRef.set({
            userId: userId,
            day: day + dayIncrement
        }, {merge: true});
        result.then(success => {
            /*console.log(table + " updated ");*/
            response.end(JSON.stringify({userId, day: (day + dayIncrement)}));
        });
    });
}

/** Get profile endpoint. */
app.get('/profile', function (req, res) {
    // Get session cookie.
    const sessionCookie = req.cookies.session || '';
    // Get the session cookie and verify it. In this case, we are verifying if the
    // Firebase session was revoked, user deleted/disabled, etc.
    admin.auth().verifySessionCookie(sessionCookie, true /** check if revoked. */)
        .then(function (decodedClaims) {
            // Serve content for signed in user.
            return serveContentForUser('/profile', req, res, decodedClaims);
        }).catch(function (error) {
        // Force user to login.
        res.redirect('/');
    });
});

function buildTips() {
    const db = admin.firestore();
    const dayOne = {
        day: '1',
        tips: "tip number one"
    };
    db.collection('tips').doc('1').set(dayOne, {merge: true});
    const dayTwo = {
        day: '2',
        tips: "tip number two"
    };
    db.collection('tips').doc('2').set(dayTwo, {merge: true});
    const dayThree = {
        day: '3',
        tips: "tip number three"
    };
    db.collection('tips').doc('3').set(dayThree, {merge: true});
}

/** Session login endpoint. */
app.post('/sessionLogin', function (req, res) {
    // Get ID token and CSRF token.
    const idToken = req.body.idToken.toString();
    const csrfToken = req.body.csrfToken.toString();

    // Guard against CSRF attacks.
    if (!req.cookies || csrfToken !== req.cookies.csrfToken) {
        res.status(401).send('UNAUTHORIZED REQUEST!');
        return;
    }
    // Set session expiration to 5 days.
    const expiresIn = 60 * 60 * 24 * 5 * 1000;
    // Create the session cookie. This will also verify the ID token in the process.
    // The session cookie will have the same claims as the ID token.
    // We could also choose to enforce that the ID token auth_time is recent.
    admin.auth().verifyIdToken(idToken).then(function (decodedClaims) {
        // In this case, we are enforcing that the user signed in in the last 5 minutes.
        if (new Date().getTime() / 1000 - decodedClaims.auth_time < 5 * 60) {
            return admin.auth().createSessionCookie(idToken, {expiresIn: expiresIn});
        }
        throw new Error('UNAUTHORIZED REQUEST!');
    })
        .then(function (sessionCookie) {
            // Note httpOnly cookie will not be accessible from javascript.
            // secure flag should be set to true in production.
            const options = {maxAge: expiresIn, httpOnly: true, secure: false /** to test in localhost */};
            res.cookie('session', sessionCookie, options);
            res.end(JSON.stringify({status: 'success'}));
        })
        .catch(function (error) {
            res.status(401).send('UNAUTHORIZED REQUEST!');
        });
});


/** User signout endpoint. */
app.get('/logout', function (req, res) {
    // Clear cookie.
    const sessionCookie = req.cookies.session || '';
    res.clearCookie('session');
    // Revoke session too. Note this will revoke all user sessions.
    if (sessionCookie) {
        admin.auth().verifySessionCookie(sessionCookie, true).then(function (decodedClaims) {
            return admin.auth().revokeRefreshTokens(decodedClaims.sub);
        })
            .then(function () {
                // Redirect to login page on success.
                res.redirect('/');
            })
            .catch(function () {
                // Redirect to login page on error.
                res.redirect('/');
            });
    } else {
        // Redirect to login page when no session cookie available.
        res.redirect('/');
    }
});

/** User delete endpoint. */
app.get('/delete', function (req, res) {
    const sessionCookie = req.cookies.session || '';
    res.clearCookie('session');
    if (sessionCookie) {
        // Verify user and then delete the user.
        admin.auth().verifySessionCookie(sessionCookie, true).then(function (decodedClaims) {
            return admin.auth().deleteUser(decodedClaims.sub);
        })
            .then(function () {
                // Redirect to login page on success.
                res.redirect('/');
            })
            .catch(function () {
                // Redirect to login page on error.
                res.redirect('/');
            });
    } else {
        // Redirect to login page when no session cookie available.
        res.redirect('/');
    }
});

// Start http server and listen to port 3000.
app.listen(3000, function () {
    console.log('Sample app listening on port 3000!')
})

buildTips();
