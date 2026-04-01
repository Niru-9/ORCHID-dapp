import { Horizon, TransactionBuilder, Networks, Contract, Address, nativeToScVal, rpc } from '@stellar/stellar-sdk';

async function testSim() {
  const rpcServer = new rpc.Server('https://soroban-testnet.stellar.org');
  const server = new Horizon.Server('https://horizon-testnet.stellar.org');
  const address = 'GBJ2XYYQNTI5YZTGEFNYM7D4R4T2N4RIVZ3YHLNDRVKGHKVHLN2Y5G2M';
  
  try {
    const account = await server.loadAccount(address);
    const fee = await server.fetchBaseFee();

    const contract = new Contract('CDFWUH33PLS2BYDBJXNY4WV7SZQYY5LL2EA6423TZQLOAHPTBA724HZL');
    const amountInStroops = '10000000';

    const op = contract.call(
      "create_escrow",
      new Address(address).toScVal(),
      new Address(address).toScVal(),
      new Address('CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC').toScVal(),
      nativeToScVal(amountInStroops, { type: 'i128' })
    );

    let tx = new TransactionBuilder(account, { fee: fee.toString(), networkPassphrase: Networks.TESTNET })
      .addOperation(op)
      .setTimeout(30)
      .build();

    let simResult = await rpcServer.simulateTransaction(tx);
    console.log(JSON.stringify(simResult, null, 2));
    
  } catch (e) {
    console.error(e);
  }
}

testSim();
