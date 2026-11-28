#[tokio::main]
async fn main() {
    let code = opensekai_transport_spike::run().await;
    std::process::exit(code);
}
