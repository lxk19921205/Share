/*
 * All the handlers used in xshare.
 */

/**
 * The number used as a socket's id.
 * Also represents how many sockets have been used.
 * Assigned starting from 1.
 * @type {Number}
 */
var socketID = 0;


/**
 * The timeout for making a pair. In milliseconds.
 * @type {Number}
 */
var TIMEOUT = 1500;


/**
 * Containing all the information of a user.
 */
function UserData() {
    /**
     * The socket id assigned.
     * @type {String}
     */
    this.id = null;
    /**
     * Socket object used in socket.io.
     * @type {Object}
     */
    this.socket = null;

    /**
     * *.*.*.*
     * @type {String}
     */
    this.ip = null;
    /**
     * e.g. 80
     * @type {Number}
     */
    this.port = null;

    /**
     * The longitude of geolocation.
     * @type {Number}
     */
    this.geoLongitude = null;
    /**
     * The latitude of geolocation.
     * @type {Number}
     */
    this.geoLatitude = null;
    /**
     * The accuracy of geolocation.
     * @type {Number}
     */
    this.geoAccuracy = null;

    /**
     * The name of the file user wants to send.
     * Or null if user just want to receive.
     * @type {String}
     */
    this.fileName = null;
    /**
     * The size of the file user wants to send.
     * Or null if user just want to receive.
     * @type {Number}
     */
    this.fileSize = null;
}


/**
 * Saving all the users that are waiting to be paired.
 */
function Users() {
    /**
     * Storing all the users.
     * 'user/socket id' => UserData
     * @type {Object}
     */
    this._store = {};

    /**
     * Remove the user's data in store.
     * @param  {Number} userID The ID of the user to be removed.
     */
    this.clear = function(userID) {
        delete this._store[userID];
    };

    /**
     * Add the user into this store for TIMEOUT milliseconds.
     * After it expires, it will be deleted and the callback will be called.
     * @param  {Object} user       The user to be added.
     * @param  {Function} callback To be called when it expires. The user will be passed.
     */
    this.addTillExpire = function(user, callback) {
        this._store[user.id] = user;

        var theID = user.id;
        var store = this._store;
        setTimeout(function() {
            if (theID in store) {
                var u = store[theID];
                callback(u);
                delete store[theID];
            }
        }, TIMEOUT);
    };

    /**
     * Given a baseUser, find the nearest user.
     * @param  {Object} baseUser The user to be compared.
     * @return {Object}          The nearest user.
     */
    this.pickUpon = function(baseUser) {
        for (var uid in this._store) {
            // TODO: just pick one...
            return this._store[uid];
        }
    };

    /**
     * Get all the users' IDs.
     * @return {Object} An array of the ids.
     */
    this.userIDs = function() {
        return Object.keys(this._store);
    };
}


/*
 * All users that are trying to send files.
 */
var toSend = new Users();
/*
 * All users that are trying to receive files.
 */
var toReceive = new Users();


/**
 * Containing the necessary for a paired connection.
 */
function Connection() {
    /**
     * The user that sends files.
     * @type {Object}
     */
    this.sender = null;
    /**
     * Whether sender has confirmed to send.
     * @type {Boolean}
     */
    this.senderConfirmed = false;
    /**
     * The user that receives files.
     * @type {Object}
     */
    this.receiver = null;
    /**
     * Whether receiver has confirmd to receive.
     * @type {Boolean}
     */
    this.receiverConfirmed = false;
    /**
     * The status of this connection.
     * Can be:
     *     INIT: just inited
     *     SENDING: sender is sending
     *     RECEIVING: receiver is receiving
     * @type {String}
     */
    this.status = "INIT";
}


/**
 * Managing all the connections that have been paired.
 * @type {Object}
 */
var paired = {
    /**
     * The data structure that stores all the connections.
     * 'senderID' => Connection
     * 'receiverID' => the same Connection
     * @type {Object}
     */
    _connections: {},

    /**
     * Remove the connection relative to this user.
     * @param  {Number} userID The ID of a user in connection.
     */
    clear: function(userID) {
        if (!(userID in this._connections)) {
            return;
        }

        var con = this._connections[userID];
        var sender = con.sender;
        var receiver = con.receiver;
        if (userID === sender.id) {
            // tell receiver
            receiver.socket.emit('betrayedSending', {
                'partnerID': sender.id
            });
        } else {
            // tell sender
            sender.socket.emit('betrayedReceiving', {
                'partnerID': receiver.id
            });
        }

        delete this._connections[sender.id];
        delete this._connections[receiver.id];
    },

    /**
     * Add a new connection after pairing.
     * @param  {Object} sender   The user that sends files.
     * @param  {Object} receiver The user that receives files.
     */
    add: function(sender, receiver) {
        this.clear(sender.id);
        this.clear(receiver.id);

        var con = new Connection();
        con.sender = sender;
        con.receiver = receiver;

        this._connections[sender.id] = con;
        this._connections[receiver.id] = con;
    },

    /**
     * A user confirms to share files.
     * @param  {Number} myID      The ID of the user that confirms.
     * @param  {Number} partnerID The ID of the other user.
     */
    confirm: function(myID, partnerID) {
        if (!(myID in this._connections) || !(partnerID in this._connections)) {
            return;
        }

        var con = this._connections[myID];
        var sender = con.sender;
        var receiver = con.receiver;

        if (sender.id === myID) {
            // this user is the sender
            con.senderConfirmed = true;
        } else {
            // this user is the receiver
            con.receiverConfirmed = true;
        }

        if (con.senderConfirmed && con.receiverConfirmed) {
            // both confirmed, real start
            sender.socket.emit('startSending', {
                'senderID': sender.id,
                'receiverID': receiver.id
            });
            receiver.socket.emit('startSending', {
                'senderID': sender.id,
                'receiverID': receiver.id
            });
            con.status = "SENDING";
        }
    }
};


/**
 * Parse the IP address of a socket.
 * @param  {Object} socket The socket to parse.
 * @return {String}        The address string.
 */
var parseAddress = function(socket) {
    return socket.handshake.address.address;
};


/**
 * Parse the port of a socket.
 * @param  {Object} socket The socket to parse.
 * @return {Number}        The port number.
 */
var parsePort = function(socket) {
    return socket.handshake.address.port;
};


/**
 * Called when a user tries to receive files.
 * @param  {Object} socket The  object used in socket.io.
 * @param  {String} receiveID   The id for the user to receive.
 * @param  {Object} geo         Null or A JSON object that contains latitude, longitude and accuracy.
 */
var onPairToReceive = function(socket, receiveID, geo) {
    toSend.clear(receiveID);
    toReceive.clear(receiveID);

    // TODO: what if the user has connected and waited for sharing's completion.

    var user = new UserData();
    user.id = receiveID;
    user.socket = socket;
    user.ip = parseAddress(socket);
    user.port = parsePort(socket);
    if (geo) {
        user.geoLatitude = geo.latitude;
        user.geoLongitude = geo.longitude;
        user.geoAccuracy = geo.accuracy;
    }

    var partner = toSend.pickUpon(user);
    if (partner) {
        // successfully finds someone to pair
        partner.socket.emit('confirmSend', {
            'partnerID': user.id,
            'fileName': partner.fileName,
            'fileSize': partner.fileSize
        });
        socket.emit('confirmReceive', {
            'partnerID': partner.id,
            'fileName': partner.fileName,
            'fileSize': partner.fileSize
        });
        toSend.clear(partner.id);

        // add into connection dict
        paired.add(partner, user);
    } else {
        // fails to pair
        toReceive.addTillExpire(user, function(u) {
            u.socket.emit('pairFailed');
        });
    }
};


/**
 * Called when a user tries to send files.
 * @param  {Object} socket   The object used in socket.io.
 * @param  {String} sendID   The id for the user to send.
 * @param  {Object} geo      Null or A JSON object that contains latitude, longitude and accuracy.
 * @param  {Object} fileInfo A JSON object that contains name, type, size, lastModifiedDate.
 */
var onPairToSend = function(socket, sendID, geo, fileInfo) {
    toSend.clear(sendID);
    toReceive.clear(sendID);

    var user = new UserData();
    user.id = sendID;
    user.socket = socket;
    user.ip = parseAddress(socket);
    user.port = parsePort(socket);
    user.fileName = fileInfo.name;
    user.fileSize = fileInfo.size;
    if (geo) {
        user.geoLongitude = geo.longitude;
        user.geoLatitude = geo.latitude;
        user.geoAccuracy = geo.accuracy;
    }

    var partner = toReceive.pickUpon(user);
    if (partner) {
        // successfully finds someone to pair
        partner.socket.emit('receive', {
            'partnerID': user.id,
            'fileName': user.fileName,
            'fileSize': user.fileSize
        });
        socket.emit('send', {
            'partnerID': partner.id,
            'fileName': user.fileName,
            'fileSize': user.fileSize
        });
        toReceive.clear(partner.id);

        // add into connection dict
        paired.add(user, partner);
    } else {
        // fails to pair
        toSend.addTillExpire(user, function(u) {
            u.socket.emit('pairFailed');
        });
    }
};


/**
 * Init the socket.
 * @param  {Object} socket The socket to init.
 */
var initSocket = function(socket) {
    // assign id for this connection
    socketID++;
    var assignedID = socketID;
    socket.emit('setID', assignedID);
    console.log('New user connected.. [ID] ' + assignedID + ' assigned');

    /**
     * Remove relative data in toSend and toReceive dictionary when disconnected.
     */
    socket.on('disconnect', function() {
        toSend.clear(assignedID);
        toReceive.clear(assignedID);
        console.log('User disconnected.. [ID] ' + assignedID);
    });

    /**
     * User tries to pair to receive files.
     */
    socket.on('pairToReceive', function(data) {
        onPairToReceive(socket, data.id, data.geo);
    });

    /**
     * User tries to pair to send files.
     */
    socket.on('pairToSend', function(data) {
        onPairToSend(socket, data.id, data.geo, data.fileInfo);
    });

    /**
     * Pair has been made, but one user disagrees to share file with the other.
     */
    socket.on('confirmFailed', function(data) {
        var myID = data.myID;
        // var partnerID = data.partnerID;
        paired.clear(myID);
    });

    /**
     * After finding two users, they confirm the connection.
     */
    socket.on('confirm', function(data) {
        paired.confirm(data.myID, data.partnerID);
    });
};

/**
 * Called in app.js to initialize and use other functions in this file.
 * @param  {Object} io The socket.io object.
 */
exports.init = function(io) {
    /**
     * When a new connection comes
     * @param  {Object} socket The socket for connection.
     */
    io.sockets.on('connection', function(socket) {
        initSocket(socket);
    });
};

exports.index = function(req, res){
    var times = 1;
    if (req.session.counter) {
        times = req.session.counter;
        req.session.counter++;
    } else {
        req.session.counter = 1;
    }

    var ctx = {
        title: 'Send or Receive '
    };
    res.render('all', ctx);
};


// TODO: req.body.* => get the post data from request.


/**
 * Handling the send file request.
 * @param  {Object} req
 * @param  {Object} res
 */
exports.send = function(req, res) {
    // TODO: may be used to save the upload file into tmp files
    res.send("Uploaded?!");
};


exports.test = function(req, res) {
    var newline = '<br/>';

    var results = "To Send: ";
    results += newline;
    var sends = toSend.userIDs();
    results += sends.join(', ');
    results += newline;

    results += "To Receive: ";
    results += newline;
    var receives = toReceive.userIDs();
    results += receives.join(', ');
    results += newline;

    res.send(200, results);
};
