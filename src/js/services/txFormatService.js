'use strict';

angular.module('copayApp.services').factory('txFormatService', function($filter, bwcService, rateService, configService, lodash) {
  var root = {};

  root.Utils = bwcService.getUtils();


  root.formatAmount = function(satoshis, fullPrecision) {
    var config = configService.getSync().wallet.settings;
    if (config.unitCode == 'sat') return satoshis;

    //TODO : now only works for english, specify opts to change thousand separator and decimal separator
    var opts = {
      fullPrecision: !!fullPrecision
    };
    return this.Utils.formatAmount(satoshis, config.unitCode, opts);
  };

  root.formatAmountStr = function(satoshis, network) {
    if (isNaN(satoshis)) return;
    var config = configService.getSync().wallet.settings;
    console.log("root.formatAmountStr network="+network);
    if (network) {
      console.log("root.formatAmountStr network exists="+network);


      var unitmap={
        'testnet':{'BTC':'tBTC','bits':'tbits'},
        'livenet':{'BTC':'BTC','bits':'bits'},
        'bcctestnet':{'BTC':'tBCC','bits':'tcash'},
        'bcclivenet':{'BTC':'BCC','bits':'cash'},

      };

      try {
        return root.formatAmount(satoshis) + ' ' + unitmap[network][config.unitName];
      } catch (e) {
        return root.formatAmount(satoshis) + ' ' + config.unitName;
      }

    }
    else
    return root.formatAmount(satoshis) + ' ' + config.unitName;


  };

  root.formatToUSD = function(satoshis, cb) {
    if (isNaN(satoshis)) return;
    var val = function() {
      var v1 = rateService.toFiat(satoshis, 'USD');
      if (!v1) return null;

      return v1.toFixed(2);
    };

    // Async version
    if (cb) {
      rateService.whenAvailable(function() {
        return cb(val());
      });
    } else {
      if (!rateService.isAvailable()) return null;
      return val();
    };
  };

  root.formatAlternativeStr = function(satoshis, cb) {
    if (isNaN(satoshis)) return;
    var config = configService.getSync().wallet.settings;

    var val = function() {
      var v1 = parseFloat((rateService.toFiat(satoshis, config.alternativeIsoCode)).toFixed(2));
      v1 = $filter('formatFiatAmount')(v1);
      if (!v1) return null;

      return v1 + ' ' + config.alternativeIsoCode;
    };

    // Async version
    if (cb) {
      rateService.whenAvailable(function() {
        return cb(val());
      });
    } else {
      if (!rateService.isAvailable()) return null;
      return val();
    };
  };

  root.processTx = function(tx,network) {
    console.log("root.processTx network="+network);

    if (!tx || tx.action == 'invalid')
      return tx;
    // New transaction output format
    if (tx.outputs && tx.outputs.length) {

      var outputsNr = tx.outputs.length;

      if (tx.action != 'received') {
        if (outputsNr > 1) {
          tx.recipientCount = outputsNr;
          tx.hasMultiplesOutputs = true;
        }
        tx.amount = lodash.reduce(tx.outputs, function(total, o) {
          o.amountStr = root.formatAmountStr(o.amount,network);
          o.alternativeAmountStr = root.formatAlternativeStr(o.amount);
          return total + o.amount;
        }, 0);
      }
      tx.toAddress = tx.outputs[0].toAddress;
    }

    tx.amountStr = root.formatAmountStr(tx.amount,network);
    tx.alternativeAmountStr = root.formatAlternativeStr(tx.amount);
    tx.feeStr = root.formatAmountStr(tx.fee || tx.fees,network);

    return tx;
  };

  root.formatPendingTxps = function(txps) {
    $scope.pendingTxProposalsCountForUs = 0;
    var now = Math.floor(Date.now() / 1000);

    /* To test multiple outputs...
    var txp = {
      message: 'test multi-output',
      fee: 1000,
      createdOn: new Date() / 1000,
      outputs: []
    };
    function addOutput(n) {
      txp.outputs.push({
        amount: 600,
        toAddress: '2N8bhEwbKtMvR2jqMRcTCQqzHP6zXGToXcK',
        message: 'output #' + (Number(n) + 1)
      });
    };
    lodash.times(150, addOutput);
    txps.push(txp);
    */

    lodash.each(txps, function(tx) {

      tx = txFormatService.processTx(tx);

      // no future transactions...
      if (tx.createdOn > now)
        tx.createdOn = now;

      tx.wallet = profileService.getWallet(tx.walletId);
      if (!tx.wallet) {
        $log.error("no wallet at txp?");
        return;
      }

      var action = lodash.find(tx.actions, {
        copayerId: tx.wallet.copayerId
      });

      if (!action && tx.status == 'pending') {
        tx.pendingForUs = true;
      }

      if (action && action.type == 'accept') {
        tx.statusForUs = 'accepted';
      } else if (action && action.type == 'reject') {
        tx.statusForUs = 'rejected';
      } else {
        tx.statusForUs = 'pending';
      }

      if (!tx.deleteLockTime)
        tx.canBeRemoved = true;
    });

    return txps;
  };

  root.parseAmount = function(amount, currency) {
    var config = configService.getSync().wallet.settings;
    var satToBtc = 1 / 100000000;
    var unitToSatoshi = config.unitToSatoshi;
    var amountUnitStr;
    var amountSat;
    var alternativeIsoCode = config.alternativeIsoCode;

    // If fiat currency
    if (currency != 'bits' && currency != 'BTC') {
      amountUnitStr = $filter('formatFiatAmount')(amount) + ' ' + currency;
      amountSat = rateService.fromFiat(amount, currency).toFixed(0);
    } else {
      amountSat = parseInt((amount * unitToSatoshi).toFixed(0));
      amountUnitStr = root.formatAmountStr(amountSat);
      // convert unit to BTC
      amount = (amountSat * satToBtc).toFixed(8);
      currency = 'BTC';
    }

    return {
      amount: amount,
      currency: currency,
      alternativeIsoCode: alternativeIsoCode,
      amountSat: amountSat,
      amountUnitStr: amountUnitStr
    };
  };

  root.satToUnit = function(amount) {
    var config = configService.getSync().wallet.settings;
    var unitToSatoshi = config.unitToSatoshi;
    var satToUnit = 1 / unitToSatoshi;
    var unitDecimals = config.unitDecimals;
    return parseFloat((amount * satToUnit).toFixed(unitDecimals));
  };

  return root;
});
