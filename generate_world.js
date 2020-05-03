var r = require('rethinkdb');

var chunks_db_con;
var chunks = [];
const WORLD_CHUNK_WIDTH = 16;
const WORLD_CHUNK_HEIGHT = 4;
const CHUNK_DIM_WIDTH = 16;
const CHUNK_DIM_HEIGHT = 16;

const block_types = Object.freeze({"air":0, "grass":1, "dirt":2, "stone": 3})

//let zfilled = ('0000'+13).slice(-4);
//console.log(zfilled);

function zFill(integer){
    return ('00'+integer).slice(-2);
}

function generate_bedrock_layer(){
    let blocks = [];
    for(let i = 0; i < CHUNK_DIM_WIDTH; i++ ){
        blocks[i] = [];
        let block_line = "";
        for(let j = 0; j < CHUNK_DIM_HEIGHT; j++){
            var rand = Math.random() * 100;

            if(rand / 100 < j / CHUNK_DIM_HEIGHT){
                blocks[i][j] = block_types.stone;
            } else {
                blocks[i][j] = block_types.dirt;
            }
            block_line += blocks[i][j] + ",";
        }
        //console.log(block_line);
    }
    return blocks;
}

function generate_land_layer(){
    let blocks = [];
    let range = 0;
    let one_or_two = Math.random();
    let height = Math.floor(Math.random() * (CHUNK_DIM_WIDTH / 3));

    if(one_or_two > 0.5){
        range = Math.PI * 2;
    } else {
        range = Math.PI;
    }

    for(let i = 0; i < CHUNK_DIM_WIDTH; i++){
        blocks[i] = [];
        let y_block = Math.ceil(CHUNK_DIM_HEIGHT / 2) - Math.floor(height * Math.sin((i/CHUNK_DIM_WIDTH) * range));
        let block_line = "";
        for(let j = 0; j < CHUNK_DIM_HEIGHT; j++){
            if(y_block == j){
                blocks[i][j] = block_types.grass;
            } else if(y_block < j){
                blocks[i][j] = block_types.air;
            } else if(y_block > j){
                blocks[i][j] = block_types.dirt;
            }
            block_line += blocks[i][j] + ",";
        }
        //console.log(block_line);
    }


    return blocks;
}

function generate_air_blocks(){
    blocks = [];
    for(let i = 0; i < CHUNK_DIM_HEIGHT; i++){
        blocks[i] = [];
        for(let j = 0; j < CHUNK_DIM_WIDTH; j++){
            blocks[i][j] = block_types.air;
        }
    }
    return blocks;
}

function generate_dirt_blocks(){
    blocks = [];
    for(let i = 0; i < CHUNK_DIM_HEIGHT; i++){
        blocks[i] = [];
        for(let j = 0; j < CHUNK_DIM_WIDTH; j++){
            blocks[i][j] = block_types.dirt;
        }
    }
    return blocks;
}

function get_starting_pos(chunk){
    let start_x = 5;
    let start_y = 0;
    for(let i = 0; i < CHUNK_DIM_HEIGHT; i++){
        if(chunk[start_x][i] == block_types.grass){
            start_y = i - 1;
        }
    }

    return { "x" : start_x, "y": start_y};
}


function generate_world(done){
    
    chunks[0] = [];
    for(let i = 0; i < WORLD_CHUNK_WIDTH; i++){
        chunks[0][i] = generate_air_blocks();
    }
    chunks[1] = [];
    for(let i = 0; i < WORLD_CHUNK_WIDTH; i++){
        chunks[1][i] = generate_land_layer();
        if(i == 0){
            let pos = get_starting_pos(chunks[1][i]);
            console.log("Starting Position:");
            console.log(pos);
        }
    }
    chunks[2] = [];
    for(let i = 0; i < WORLD_CHUNK_WIDTH; i++){
        chunks[2][i] = generate_dirt_blocks();
    }
    chunks[3] = [];
    for(let i = 0; i < WORLD_CHUNK_WIDTH; i++){
        chunks[3][i] = generate_bedrock_layer();
    }

    //console.log(chunks[1][3]);
   
    done();
}

r.connect({
    db: 'test'
  }, function(err, conn) {
    if(err){
      console.log(err);
    }
    if(conn){
        chunks_db_con = conn;
      console.log("Connected to test");

      generate_world(function(){
        console.log("Generate complete.")
        //console.log(chunks[0][3]);
    
        chunk_data_to_send = [];
    
        for(let i = 0; i < WORLD_CHUNK_HEIGHT; i++){
            for(let j = 0; j < WORLD_CHUNK_WIDTH; j++){
                let _chunk_id = "chunk_" + zFill(i) + "_" + zFill(j);
                let chunk = chunks[i][j];
                //console.log(_chunk_id);
                //console.log(chunk);
                chunk_data_to_send.push({
                    chunk_id : _chunk_id,
                    chunk_data : chunk
                });
                
            }
        }
        r.table("chunks").delete().run(chunks_db_con, function(){
            console.log("All chunks deleted?");
            r.table("chunks").insert(chunk_data_to_send).run(chunks_db_con, function(){
                console.log("Done");
            });
        })
    })
          
    }
});