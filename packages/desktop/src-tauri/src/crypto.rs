use rand::Rng;

/// Generate a random hex secret for auth.
pub fn generate_secret() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
    hex::encode(&bytes)
}

/// Simple hex encoding (to avoid adding the hex crate just for this).
mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }
}
