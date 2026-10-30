// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Before any window. `mcp` is the delivery pipe, the same bytes as apps/mcp.
    if std::env::args().nth(1).as_deref() == Some("mcp") {
        std::process::exit(app_lib::mcp_pipe_main());
    }
    app_lib::run();
}
