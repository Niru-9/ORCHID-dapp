const { Keypair } = require('@stellar/stellar-sdk');

async function createAndFund() {
  const pair = Keypair.random();
  console.log('PUBLIC: ' + pair.publicKey());
  console.log('SECRET: ' + pair.secret());

  try {
    const res = await fetch('https://friendbot.stellar.org?addr=' + encodeURIComponent(pair.publicKey()));
    const data = await res.json();
    console.log('Funded successfully on testnet!');
  } catch (e) {
    console.error('Error funding: ', e);
  }
}

createAndFund();
