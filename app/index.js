'use strict';

//INIT EXPRESS
var express = require('express');
var app = express();

//INIT HTTP SERVER CODE
var http = require('http').Server(app);

//INIT SOCKET.IO
var io = require('socket.io')(http);

//BEGIN HOSTING THE APP
var port = 8080;
http.listen(port,function(){
    console.log("The process is running on port:"+port);
});

////////////////////////////////////////////////////////////////////////////////
//
//                          Game Managment Methods
//
////////////////////////////////////////////////////////////////////////////////

const NUM_SHIPS = 5;
const BOARD_SIZE = 10;

var users = [];
var games = [];

var tileManipulator = {
  placeRight: function(array, x, y) {
    return {'success': placeTile(array, x+1, y), 'x' : x+1, 'y' : y};
  },
  placeLeft: function(array, x, y) {
    return {'success': placeTile(array, x-1, y), 'x' : x-1, 'y' : y};
  },
  placeUp: function(array, x, y) {
    return {'success': placeTile(array, x, y-1), 'x' : x, 'y' : y-1};
  },
  placeDown: function(array, x, y) {
    return {'success': placeTile(array, x, y+1), 'x' : x, 'y' : y+1};
  }
}

//CONNECTION CONSTRUCTOR
function connection(socket,id){
    this.socket = socket;
    this.id = id;
    this.token = generateToken();
    // this.currGame initialized later
    // this.displayBoard initialized later
    this.hasGame = function() {
      return this.currGame!=undefined;
    }

    this.isOwner = function() {
      if(this.hasGame()) {
        return this.currGame.owner == this;
      }
      return false;
    }

    this.leaveGame = function() {
      if(this.hasGame()) {
        if(this.currGame.removePlayer(this)) {
          this.currGame = null;
          return true;
        }
      }
      return false;
    }

    this.getOpponent = function() {
      if(this.hasGame() && this.currGame.canStart()) { // Checks game exists, and players exist
        if(this.isOwner()) {
          return this.currGame.player2;
        }
        return this.currGame.owner;
      }
    }

    this.checkWin = function() {
      if(this.hasGame() && this.currGame.canPlay()) {
        var oppBoard = this.displayBoard.gameBoard.board;
        for(var i = 0; i < oppBoard.length; i ++) {
          for(var j = 0; j < oppBoard[i].length; j++) {
            if((oppBoard[i][j] == 1) && (this.displayBoard.board[i][j] != 1)) {
              return false;
            }
          }
        }
        return true;
      }
      return false;
    }

    this.updateBoard = function() {
      this.socket.emit('updateBoard', {'board' : this.displayBoard.board})
    }

    this.success = function(action, message) {
      message = message || "";
      this.socket.emit('success', {'action' : action, 'message' : message});
    }

    this.error = function(action, errorCode, message, parameters) {
      message = message || "";
      parameters = parameters || {};
      errorCode = errorCode || 0;
      console.log(JSON.stringify({'action' : action, 'errorCode' : errorCode, 'message' : message, 'parameters': parameters}));
      this.socket.emit('failure', {'action' : action, 'errorCode' : errorCode, 'message' : message, 'parameters': parameters});
    }
    users.push(this);
}

//GAME CONSTRUCTOR
function game(owner) {
  this.owner = owner;
  this.id = generateGameID();
  this.gameState = 0;
  // this.player2;
  // this.ownerBoard;
  // this.player2Board;
  // this.currTurn (true is owner, false is player2)
  this.canStart = function() {
    return (this.player2 != undefined && this.owner != undefined);
  }
  this.canPlay = function() {
    return (this.ownerBoard != undefined && this.player2Board != undefined &&
      this.ownerBoard.success && this.player2Board.success);
  }
  this.removePlayer = function(player) {
    if(this.owner == player) {
      delete this.owner;
      return true;
    } else if(this.player2 == player) {
      delete this.player2;
      return true;
    }
    return false;
  }

  this.getCurrPlayer = function() {
    if(this.currTurn!=undefined) {
      if(this.currTurn) {
        return this.owner;
      } else {
        if(this.player2!=undefined) {
          return this.player2;
        }
      }
    }
    return -1;
  }
  games.push(this);
}

//BATTLE SHIP CONSTRUCTOR
function regShip(length, orientation) {
  this.size = length;
  this.orientation = orientation;
  this.coords = [];
  this.sigCoord = [];
  this.sunk = false;
  switch(length) {
    case 2:
      this.type = "patrol";
      break;
    case 3:
      this.type = "cruiser";
      break;
    case 4:
      this.type = "battleship";
      break;
    default:
      this.type = "";
  }
  this.place = function(gameBoard, x, y) {
    var valid = true;
    this.sigCoord = buildArr(x,y);
    for(var i = 0; i < length; i ++) {
      switch(orientation) {
        case 0:
          valid = valid && placeTile(gameBoard, x+i, y);
          this.coords.push([x+i,y]);
          break;
        case 1:
          valid = valid && placeTile(gameBoard, x, y-i);
          this.coords.push([x,y-i]);
          break;
        case 2:
          valid = valid && placeTile(gameBoard, x-i, y);
          this.coords.push([x-i,y]);
          break;
        case 3:
          valid = valid && placeTile(gameBoard, x, y+i);
          this.coords.push([x,y+i]);
          break;
        default:
          valid = false;
      }
    }
    return valid;
  }
  this.isSunk = function(dispBoard) {
    for(var i = 0; i < this.coords.length; i ++) {
      if(dispBoard.board[(this.coords[i][1])][(this.coords[i][0])] != 1) {
        this.sunk = false;
        return false;
      }
    }
    this.sunk = true;
    return true;
  }
}

// Submarine "T" Shaped and
// Aircraft Carrier pictured below
//          001110
//          011100
function specialShip(type, orientation) {
  this.orientation = orientation;
  this.sigCoord = [];
  this.type = type.toLowerCase();
  this.sunk = false;
  switch(type.toUpperCase()) {
    /*
    ** 1X1  X = coordinate passed to place function
    ** 010  This is orientation 0
    */
    case "SUBMARINE" :
      this.size = 4;
      this.coords = [];
      this.place = function(gameBoard, x, y) {
        var valid = true;
        if(orientation!=0) {
          valid = valid && placeTile(gameBoard,x,y-1);
          this.coords.push([x,y-1]);
        }
        if(orientation!=1) {
          valid = valid && placeTile(gameBoard,x-1,y);
          this.coords.push([x-1,y]);
        }
        if(orientation!=2) {
          valid = valid && placeTile(gameBoard,x,y+1);
          this.coords.push([x,y+1]);
        }
        if(orientation!=3) {
          valid = valid && placeTile(gameBoard,x+1,y);
          this.coords.push([x+1,y]);
        }
        valid = valid && placeTile(gameBoard, x, y);
        this.coords.push(buildArr(x,y));
        this.sigCoord = buildArr(x,y);
        return valid;
      }
      break;
    /*
    ** 001110 X = coordinate passed to place function
    ** 0X1100 This is orientation 0
    */
    case "AIRCRAFT CARRIER" :
      this.size = 6;
      this.coords = [];
      this.place = function(gameBoard, x, y) {
        var up, down, left, right;
        var valid = true;
        if(orientation==0){
          up = tileManipulator.placeUp;
          down = tileManipulator.placeDown;
          right = tileManipulator.placeRight;
          left = tileManipulator.placeLeft;
        } else if(orientation == 1) {
          up = tileManipulator.placeLeft;
          down = tileManipulator.placeRight;
          right = tileManipulator.placeUp;
          left = tileManipulator.placeDown;
        } else if(orientation == 2) {
          up = tileManipulator.placeDown;
          down = tileManipulator.placeUp;
          right = tileManipulator.placeLeft;
          left = tileManipulator.placeRight;
        } else if(orientation == 3) {
          up = tileManipulator.placeRight;
          down = tileManipulator.placeLeft;
          right = tileManipulator.placeDown;
          left = tileManipulator.placeUp;
        }
        valid = valid && placeTile(gameBoard, x, y);
        this.coords.push(buildArr(x,y));
        this.sigCoord = buildArr(x,y);
        var thisObj = this;
        function placeDir(func) {
          var res = func(gameBoard,x,y);
          valid = valid && res.success;
          x = res.x;
          y = res.y;
          thisObj.coords.push(buildArr(x,y));
        }
        placeDir(right);
        valid = valid && up(gameBoard,x,y).success; // place up, but don't continue from there
        switch(orientation) {
          case 0:
            this.coords.push(buildArr(x,y-1));
            break;
          case 1:
            this.coords.push(buildArr(x-1,y));
            break;
          case 2:
            this.coords.push(buildArr(x,y+1));
            break;
          case 3:
            this.coords.push(buildArr(x+1,y));
            break;
        }
        placeDir(right);
        placeDir(up);
        placeDir(right);
        return valid;
      }
      break;
    default:
      this.size = 0;
      this.type = "";
  }
  this.isSunk = function(dispBoard) {
    for(var i = 0; i < this.coords.length; i ++) {
      if(dispBoard.board[(this.coords[i][1])][(this.coords[i][0])] != 1) {
        this.sunk = false;
        return false;
      }
    }
    this.sunk = true;
    return true;
  }
}

//GAME BOARD CONSTRUCTOR
function gameBoard(width, height, ships) {
  var res = setupBoard(width,height,ships);
  this.success = res.success;
  if(res.success) {
    this.board = res.board;
    this.ships = res.ships;
  } else {
    this.board = [[]];
    this.ships = [];
  }
  this.isOccupied = function(x,y) {
    return this.board[y][x] == 1;
  }
}

//OPPONENT BOARD CONSTRUCTOR
function dispBoard(width, height, oppBoard) {
  this.board = fillArray(width,height, 0);
  this.gameBoard = oppBoard;
  this.checkPoint = function(x,y) {
    if(this.gameBoard.isOccupied(x,y)) {
      this.board[y][x] = 1;
    } else {
      this.board[y][x] = 2;
    }
  }
}

function findUser(token) {
  for(var i = 0; i < users.length; i ++) {
    if(users[i].token == token) {
      return users[i];
    }
  }
  return -1;
}

function findGame(id) {
  for(var i = 0; i < games.length; i ++) {
    if(games[i].id == id) {
      return games[i];
    }
  }
  return -1;
}

function generateToken() {
  var token = 0;
  do {
    token = Math.round(Math.random()*1000000);
  } while(findUser(token)!=-1)
  return token;
}

function generateGameID() {
  var id = 0;
  do {
    id = Math.round(Math.random()*1000000);
  } while(findGame(id)!=-1)
  return id;
}

// check that there is one of each of the right ship
function checkShips(shipArr) {
  var types = ["patrol","cruiser","battleship","submarine","aircraft carrier"];
  var successes = 0;
  for(var j = 0; j < shipArr.length; j ++) {
    var ship = shipArr[j];
    for(var i = 0; i < types.length; i ++) {
      if(ship.type == types[i]) {
        types.splice(i,1);
        successes++;
        break;
      }
    }
  }
  return successes == NUM_SHIPS;
}

// used to init the battleship board
function fillArray(rows, columns, value) {
  var array = new Array(rows);
  for(var i = 0; i < rows; i ++) {
      array[i] = new Array(columns);
      for(var j = 0; j < columns; j ++) {
        array[i][j] = value;
      }
  }
  return array;
}

// ship: {type: "", length:0, orientation: 0, x:0, y:0}
function setupBoard(rows,columns,ships) {
  if(ships.length == 5) {
    var board = fillArray(rows, columns, 0);
    var shipsArr = [];
    var valid = true;
    for(var i = 0; i < ships.length; i ++) {
      var shipObj;
      var ship = ships[i];
      if(ship.type.toUpperCase()=="SUBMARINE" || ship.type.toUpperCase()=="AIRCRAFT CARRIER") {
        shipObj = new specialShip(ship.type,ship.orientation);
      } else {
        shipObj = new regShip(ship.length, ship.orientation);
      }
      shipsArr.push(shipObj);
      valid = valid && shipObj.place(board, ship.x, ship.y);
    }
    valid = valid && checkShips(shipsArr);
    return {'board' : board, 'ships' : shipsArr, 'success' : valid};
  }
}

// Checks all precautions before putting tile on board
function placeTile(array, x, y) {
  if((x >= 0 && x < array[0].length) && (y >= 0 && y < array.length)) {
    if(array[y][x] == 0) {
      array[y][x] = 1;
      return true;
    }
  }
  return false;
}

function notifyIfSunk(user) {
  var board;
  if(user.isOwner()) {
    board = user.currGame.player2Board;
  } else if(user.hasGame()) {
    board = user.currGame.ownerBoard;
  } else {
    return;
  }
  for(var i = 0; i < board.ships.length; i ++){
    if(!board.ships[i].sunk && board.ships[i].isSunk(user.displayBoard)) {
      user.socket.emit('sinkUpdate', {'type': board.ships[i].type, 'coordX': board.ships[i].sigCoord[0],
        'coordY': board.ships[i].sigCoord[1], 'orientation': board.ships[i].orientation});
    }
  }
}

function buildArr(x,y) {
  var arr = new Array(2);
  arr[0] = x;
  arr[1] = y;
  return arr;
}

////////////////////////////////////////////////////////////////////////////////
//
//                      Client Connection Handling
//
////////////////////////////////////////////////////////////////////////////////

io.on('connection', function(socket) {
  var user = new connection(socket,socket.id);
  users.push(user);

  socket.on('createGame', function(data) {
    if(!user.hasGame()){
      user.currGame = new game(user);
      user.success("CreateGame",user.currGame.id);
    } else {
      user.error("CreateGame", 0, "This user already has a game", data);
    }
  });

  // {ID: (6 Digit Int)}
  socket.on('joinGame', function(data) {
    var game = findGame(data.ID);
    if(game!=-1 && !user.hasGame() && game.player2 == undefined){
      user.currGame = game;
      game.player2 = user;
      user.currGame.owner.socket.emit("canStart",{});
      user.success("JoinGame");
    } else if(game==-1){
      user.error("JoinGame", 0, "That game does not exist", data);
    } else if(user.hasGame()){
      user.error("JoinGame", 1, "This user is already in a game", data);
    } else {
      user.error("JoinGame", 2, "This game already has a second player", data);
    }
  });

  socket.on('startGame', function(data) {
    if(user.isOwner() && user.currGame.canStart() && user.currGame.gameState == 0){
      user.currGame.gameState = 1;
      user.success('StartGame');
      user.socket.emit('setupBoard',{});
      user.currGame.player2.socket.emit('setupBoard', {});
    } else {
      if(!user.isOwner()) {
        user.error('StartGame', 0, "This user is not the group owner, so they cannot start the match", data);
      } else if(!user.currGame.canStart()){
        user.error('StartGame', 1, "This game does not have a second player yet, so the match cannot start", data);
      } else {
        user.error('StartGame', 2, "This game has already been started");
      }
    }
  });

  // {ships: [{}, {}, {}, {}, {}]}
  socket.on('setBoard', function(data) {
    var board = new gameBoard(BOARD_SIZE, BOARD_SIZE, data.ships);
    if(user.isOwner()) {
      if(user.currGame.ownerBoard==undefined || user.currGame.ownerBoard.success == false) {
        user.currGame.ownerBoard = board;
      } else {
        user.error("SetBoard", 0, "User already has a board", data);
      }
    } else if(user.hasGame()){
      if(user.currGame.player2Board==undefined || user.currGame.player2Board.success == false) {
        user.currGame.player2Board = board;
      } else {
        user.error("SetBoard", 0, "User already has a board", data);
      }
    } else {
      user.error("SetBoard", 1, "User not in valid game", data);
    }
    if(board.success && user.hasGame()) {
      user.success("SetBoard");
      if(user.currGame.canPlay()) {
        user.currGame.owner.socket.emit('canPlay',{});
      }
    } else {
      user.error("SetBoard", 2, "Invalid ship placement", data);
    }
  });

  socket.on('getBoard', function(data) {
    if(user.isOwner() && user.currGame.ownerBoard !=undefined) {
      user.success("GetBoard");
      socket.emit("getBoard", {'board' : user.currGame.ownerBoard.board});
    } else if(!user.isOwner() && user.currGame !=undefined && user.currGame.player2Board!=undefined) {
      user.success("GetBoard");
      user.socket.emit("getBoard", {'board' : user.currGame.player2Board.board});
    } else if(!user.hasGame()) {
      user.error("GetBoard", 0, "This user does not have a game", data);
    } else if(!user.currGame.canPlay()) {
      user.error("GetBoard", 1, "This user does not have a board", data);
    } else {
      user.error("GetBoard", 2, "Unknown Exception", data);
    }
  });

  socket.on('startPlay', function(data) {
    if(user.isOwner() && user.currGame.canPlay() && user.currGame.gameState == 1){
      user.currGame.gameState = 2;
      user.success('StartPlay');
      user.socket.emit('startGame',{});
      user.currGame.player2.socket.emit('startGame', {});
      user.currGame.currTurn = (Math.round(Math.random()) == 0);
      user.displayBoard = new dispBoard(BOARD_SIZE, BOARD_SIZE, user.currGame.player2Board);
      user.currGame.player2.displayBoard = new dispBoard(BOARD_SIZE, BOARD_SIZE, user.currGame.ownerBoard);
      user.currGame.getCurrPlayer().socket.emit("takeTurn",{});
    } else {
      if(!user.isOwner()) {
        user.error('StartPlay', 0, "This user is not the group owner, so they cannot start the match", data);
      } else if (!user.currGame.canPlay()){
        user.error('StartPlay', 1, "This game does not have all completed boards yet, so the match cannot start", data);
      } else {
        user.error('StartPlay', 2, "This game is still in the joining phase, try startGame before startPlay", data);
      }
    }
  });

  // {x:0, y:0}
  socket.on('submitTurn', function(data) {
    if(user.currGame.getCurrPlayer() == user && user.currGame.gameState == 2) {
      user.displayBoard.checkPoint(data.x,data.y);
      user.success("SubmitTurn");
      user.updateBoard();
      user.getOpponent().socket.emit("updateOppDisp", {'board':user.displayBoard.board});
      notifyIfSunk(user);
      if(user.checkWin()) {
        user.socket.emit("victory", {});
        user.getOpponent().socket.emit("loss", {});
        var playerBoard, otherBoard;
        if(user.isOwner()) {
          playerBoard = user.currGame.ownerBoard;
          otherBoard = user.currGame.player2Board;
        } else {
          playerBoard = user.currGame.player2Board;
          otherBoard = user.currGame.ownerBoard;
        }
        user.socket.emit('getOppBoard', {'board' : otherBoard.board});
        user.getOpponent().socket.emit('getOppBoard', {'board' : playerBoard.board});
        delete user.getOpponent().displayBoard;
        delete user.currGame;
        delete user.displayBoard;
        games.splice(games.indexOf(user.currGame));
      } else {
        user.currGame.currTurn = !user.currGame.currTurn;
        user.currGame.getCurrPlayer().socket.emit("takeTurn", {});
      }
    } else if (!(user.currGame.getCurrPlayer() == user)){
      user.error("SubmitTurn", 0, "It is not this users turn", data);
    } else if(user.currGame.gameState!=2) {
      user.error("SubmitTurn", 1, "The game has not yet started", data);
    }
  });

  socket.on('getId', function() {
    user.socket.emit('getId',{'ID':user.socket.id});
  });

  socket.on('disconnect', function() {
    users.splice(users.indexOf(user),1);
    if(user.hasGame() && user.currGame.canStart()) {
      user.getOpponent().socket.emit("partnerDisconnect",{});
      var game = user.currGame;
      var opp = user.getOpponent();
      games.splice(games.indexOf(game,1));
      if(opp!=undefined) {
        delete opp.currGame;
        delete opp.displayBoard;
      }
    }
  });
});
