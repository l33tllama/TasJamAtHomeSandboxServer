const WebSocket = require('ws');
var r = require('rethinkdb');

const wss = new WebSocket.Server({ port: 8082 });

var players_db_conn;
var chunks_db_con;
let connection_id = 0;
let ws_connections = [];
var connected_count = 0;
let connections = false;
let timeout_id = 0;

const CHUNK_DIM_WIDTH = 16;
const CHUNK_DIM_HEIGHT = 16;
const WORLD_CHUNK_WIDTH = 16;
const WORLD_CHUNK_HEIGHT = 4;
const TILE_WIDTH = 64;
const TiLE_HEIGHT = 64;

let starting_position = { x: 5 * TILE_WIDTH, y: (16 + 4) * TiLE_HEIGHT };

function zFill(integer){
  return ('00'+integer).slice(-2);
}

// If we hear nothing from a client

function timeout(){
  connections = true;
  clearTimeout(timeout_id);
  timeout_id = setTimeout(function(){
    console.log("Connection timeout");
    connections = false;
  }, 10000);
}


r.connect({
  db: 'test'
}, function(err, conn) {
  if(err){
    console.log(err);
  }
  if(conn){
    players_db_conn = conn;

        // Update connected clients with other connected clients positions
    setInterval(function(){
      if(connections){
        db_get_connected_clients(function(results){
          let players_data = []
          for(let i = 0; i < results.length; i++){
            players_data.push({
              "uuid" : results[i]["uuid"],
              "position" : results[i]["position"]
            });
          }
          if(players_data.length > 0){
            let update_obj = {
              "uuid" : "none",
              "data" : {
                "cmd" : "other_players_data",
                "data" : {
                  "players" : players_data
                }
                
              }
            }
            broadcast_message_obj(update_obj);
          }
        })
      } 
    }, 50);
    
    /*r.table("players").insert({
      name: "Spamalot",
      uuid: "12345"
    }).run(players_db_conn, function(){
      console.log("Done");
    })*/
  }
});

// Add new player to database if not exists
function db_add_new_player(_name, _uuid, cb){
  console.log("Read new player: " + _name + " uuid: " + _uuid);

  // Find a player with same UUID
  r.table("players").filter({uuid : _uuid}).run(players_db_conn, function(err, cursor){
    if(err) throw err;

    cursor.next(function(err, row){
      if(err){
        //console.log(err);
        if(err.msg == "No more rows in the cursor."){
          console.log("Player does not exist, adding..")
          r.table("players").insert({
            name : _name,
            uuid : _uuid,
            position : starting_position,
            health: 100,
            connected: true
          }).run(players_db_conn, function(resp){
            console.log("New player added!")
            send_message_player_added(_uuid);
            //db_add_player_to_connected_players(_uuid, _name, cb);
          })
        }
      } else {
        r.table("players").filter({uuid : _uuid}).update({"connected" : true}).run(players_db_conn, function(err, results){
          console.log("Player connected");
        })
        console.log("Player exists: ");
        console.log(row);
        send_message_player_added(_uuid);
        //db_add_player_to_connected_players(_uuid, _name);
      }
    });
  });
}

// Query DB for particular player's position
function db_get_player_pos(_uuid, cb){
  r.table("players").filter({uuid : _uuid}).run(players_db_conn, function(err, cursor){
    cursor.next(function(err, row){
      if(err){
        //console.log(err);
        if(err.msg == "No more rows in the cursor."){
        }
      } else{
        console.log("Player with matching uuid:");
        console.log(row);
        let position = {};
        try{
          position = row["position"];
          console.log("Found player pos");
          console.log(position);
          cb(position);
        } catch(e){
          console.log(e);
        }
        // cb();
      }
    });
  });
}

function db_disconnect_player(uuid){
  r.table("players").filter({"uuid" : uuid}).update({"connected" : false}).run(players_db_conn, function(err, results){
    if(err) throw err;
    console.log("Player set to disconnected")
  })
}

function get_player_pos(_uuid){
  db_get_player_pos(_uuid, function(position){
    console.log("Got position: ");
    console.log(position);
    let message = {
      "uuid" : _uuid,
      "data" : {
        "cmd" : "update_player_pos",
        "player_position" : position
      }
    }
    let message_str = JSON.stringify(message);
    send_message_to_uuid(_uuid, message_str);
  })
}

function db_get_chunk(chunk_id, cb){
  //console.log("Getting chunk: " + chunk_id);
  r.table("chunks").filter({"chunk_id" : chunk_id}).run(players_db_conn, function(err, cursor){
    cursor.next(function(err, row){
      if(err){
        //console.log(err);
        cb([]);
        if(err.msg == "No more rows in the cursor."){
          console.log("No chunks for id: " + chunk_id);
        }
      } else{
        //console.log("Got chunk data:");
        //console.log(row);
        cb(row["chunk_data"]);
      }
    });
  });
}

//Get chunk data from DB, send to player 
function get_chunk_at_pos(x, y, cb){
  let chunk_x = Math.floor(x / CHUNK_DIM_WIDTH);
  let chunk_y = Math.floor(y / CHUNK_DIM_HEIGHT);

  let chunk_id = "chunk_" + zFill(chunk_y) + "_" + zFill(chunk_x);

  let chunk_x_left = Math.max(Math.floor((x - CHUNK_DIM_WIDTH) / CHUNK_DIM_WIDTH), 0);
  let chunk_x_right = Math.min(Math.floor((x + CHUNK_DIM_WIDTH) / CHUNK_DIM_WIDTH), WORLD_CHUNK_WIDTH);
  let chunk_y_up =  Math.max(Math.floor((y - CHUNK_DIM_HEIGHT) / CHUNK_DIM_HEIGHT), 0);
  let chunk_y_down = Math.min(Math.floor((y + CHUNK_DIM_HEIGHT) / CHUNK_DIM_HEIGHT), WORLD_CHUNK_HEIGHT);
  
  let chunk_left = [];
  let chunk_right = [];
  let chunk_up = [];
  let chunk_down = []
  
  let chunk_id_left = "";
  let chunk_id_right = "";
  let chunk_id_up = "";
  let chunk_id_down = "";
  if(chunk_x_left != 0){
    chunk_id_left = "chunk_" + zFill(chunk_y) + "_" + zFill(chunk_x_left);
  }
  if(chunk_id_right != WORLD_CHUNK_WIDTH){
    chunk_id_right = "chunk_" + zFill(chunk_y) + "_" + zFill(chunk_x_right);
  }
  if(chunk_id_up != 0){
    chunk_id_up = "chunk_" + zFill(chunk_y_up) + "_" + zFill(chunk_x);
  }
  if(chunk_id_down != WORLD_CHUNK_HEIGHT){
    chunk_id_down = "chunk_" + zFill(chunk_y_down) + "_" + zFill(chunk_x);
  }

  
  // Whoo, chain functions!
  db_get_chunk(chunk_id, function(_chunk){
    chunk = _chunk;
    db_get_chunk(chunk_id_left, function(_chunk_l){
      chunk_left = _chunk_l;
      db_get_chunk(chunk_id_right, function(_chunk_r){
        chunk_right = _chunk_r;
        db_get_chunk(chunk_id_up, function(_chunk_u){
          chunk_up = _chunk_u;
          db_get_chunk(chunk_id_down, function(_chunk_d){
            chunk_down = _chunk_d;
            let all_chunks = {
              "center" : chunk,
              "left" : chunk_left,
              "right" : chunk_right,
              "up" : chunk_up,
              "down" : chunk_down
            }
            cb(all_chunks);
          });
        });
      });
    });
  });
  
}

// Get position from data, get chunks around position and send chunks
function send_chunk_data_fom_pos(uuid, data){
  
  let pos = data["position"];
  let x = pos["x"];
  let y = pos["y"];

  get_chunk_at_pos(x, y, function(chunks){
    let data_to_send = {
      "cmd" : "chunk_data",
      "data" : {
        "chunks" : chunks
      }
    }
    send_message(uuid, data_to_send);
  });
}


// New player message handler
function msg_new_player(data, uuid){
  let player_name = "";
  try {
    player_name = data["name"];
  } catch (e){
    console.log(e);
  }
  if(player_name != ""){
    db_add_new_player(player_name, uuid);
  }
}

function db_update_player_pos(uuid, pos){
  r.table("players").filter({"uuid" : uuid}).update({"position" : pos}).run(players_db_conn, function(err, result){
    if (err){
      console.log(err);
    }
  })
}

function update_player_pos(uuid, data){
  var position = data["position"];
  db_update_player_pos(uuid, position);
}

function broadcast_new_player(uuid, player_name){
  var data = {
    "uuid" : uuid, 
    "data" : {
      "cmd" : "new_player",
      "data" : {
        "name" : player_name,
        "uuid" : uuid
      }
    }
  }
  broadcast_message_obj(data, uuid);
}

function broadcast_message_obj(data, omit_uuid){
  let message = JSON.stringify(data);
  if(ws_connections.length > 0){
    //console.log("Broadcasing message: (but with new uuid)" + message);
  }  
  for(let i = 0; i < ws_connections.length; i++){
    
    let ws_i = ws_connections[i][0];
    if(ws_i != null){
      //console.log(ws_connections[i][1]);
      if(ws_connections[i][1]){
        data["uuid"] = ws_connections[i][1];
      }
      let message = JSON.stringify(data);
      //console.log("Sending broadcast message to " + i + ": " + message);
      ws_i.send(message);
    }    
  }
}

function send_client_data(uuid){
  db_get_connected_clients(function(results){
    for(let i = 0; i < results.length; i++){
      var data = {
        "cmd" : "new_player",
        "data" : {
          "name" : results[i]["name"],
          "uuid" : results[i]["uuid"]
        }
      }
      console.log("Sending new player for new player");
      console.log(data);
      send_message(uuid, data);
    }
  })
}

// Command handler - do different things depending on command
function handle_command(cmd, data, uuid){
  switch(cmd){
    case "new_player":
      console.log("Received command: New player");
      console.log(data);
      msg_new_player(data, uuid);
      broadcast_new_player(uuid, data["name"]);
      setTimeout(function(){
        send_client_data(uuid)
      }, 450);
      break;
    case "get_player_pos":
      get_player_pos(uuid);
      break;
    case "get_chunk_at_pos":
      send_chunk_data_fom_pos(uuid, data);
      break;
    case "update_player_pos":
      update_player_pos(uuid, data);
      break;
    case "quit":
      db_disconnect_player(uuid);
      console.log("client quit")
      break
    case "ping":
      timeout();
      break;
    default:
      console.log("Received some other command: " + cmd);
      console.log(data);
  }
}

// parse message and send to command handler
function handle_message(obj, c_id){
  let uuid = "";
  let cmd = "";
  let packet_data = {};
  let message_data = {};
  try{
    uuid = obj["uuid"];
    //console.log("uuid: " + uuid);
    packet_data = obj["data"];
    //console.log("packet data: ")
    //console.log(packet_data);
    cmd = packet_data["cmd"];
    //console.log("cmd: " + cmd);
    message_data = packet_data["data"];
    //#console.log("Setting connection id" + c_id + " uuid");
    ws_connections[c_id][1] = uuid;
    handle_command(cmd, message_data, uuid);
  } catch(e){
    console.log(e);
  }
}

function get_connection_id_by_uuid(uuid){
  let latest_connection_i = -1;
  for(let i = 0; i < ws_connections.length; i++){
    if(ws_connections[i][1] == uuid){
      latest_connection_i = i;
    }
  }
  return latest_connection_i;
}

function send_message_to_uuid(_uuid, message_str){
  let c_id = get_connection_id_by_uuid(_uuid);
  if(c_id >= 0){
    console.log("Sending message to id " + c_id + ": " + message_str);
    let ws = ws_connections[c_id][0];
    ws.send(message_str);
  }
}

// Send a message to clients
function send_message(uuid, data){
  let msg_data = {
    "uuid" : uuid,
    "data" : data
  }
  try{
    let message = JSON.stringify(msg_data);
    send_message_to_uuid(uuid, message);
    
  } catch (e){
    console.log(e);
    console.log("Bad data for sending");
    console.log(data);
    console.log(msg_data);
  }
}

// Send a message to the client that was just being added to the game (new player)
function send_message_player_added(uuid){
  let data = {
    "cmd" : "player_added"
  }
  send_message(uuid, data);
}



// When client connects
wss.on('connection', function connection(ws, request, client) {
  console.log(`New connection ${client}`);

  ws_connections[connection_id] = [];
  ws_connections[connection_id][0] = ws;

  let c_id = connection_id;

  timeout();
  
  // Register message handler for this client
  ws.on('message', function incoming(message) {
    //console.log(`Received message ${message} from user ${client}`);
    let msg_obj = {};
    try{
      msg_obj = JSON.parse(message);
      handle_message(msg_obj, c_id);
    } catch (e){
      console.log(e);
    }
    
  });

  connection_id = connection_id + 1;

  ws.send(`Hello connection ID ${connection_id}`);

});

wss.on("close", function(){
  console.log("A connection closed");
  connected_count--;
})


function db_get_connected_clients(cb){
  r.table("players").filter({"connected" : true}).run(players_db_conn, function(err, cursor){
    cursor.toArray(function(err, results){
      if (err) throw err;
      //console.log("COnnected players");
      //console.log(results);
      cb(results);
    })
  })
}


