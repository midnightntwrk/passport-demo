import * as __compactRuntime from '@midnight-ntwrk/compact-runtime';
__compactRuntime.checkRuntimeVersion('0.19.0');

const _descriptor_0 = new __compactRuntime.CompactTypeUnsignedInteger(18446744073709551615n, 8);

const _descriptor_1 = new __compactRuntime.CompactTypeBytes(32);

class _ContractAddress_0 {
  alignment() {
    return _descriptor_1.alignment();
  }
  fromValue(value_0) {
    return {
      bytes: _descriptor_1.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0.bytes);
  }
}

const _descriptor_2 = new _ContractAddress_0();

const _descriptor_3 = __compactRuntime.CompactTypeJubjubPoint;

const _descriptor_4 = __compactRuntime.CompactTypeField;

const _descriptor_5 = __compactRuntime.CompactTypeSecp256k1Point;

const _descriptor_6 = __compactRuntime.CompactTypeSecp256k1Scalar;

class _Secp256k1EcdsaSignature_0 {
  alignment() {
    return _descriptor_6.alignment().concat(_descriptor_6.alignment());
  }
  fromValue(value_0) {
    return {
      r: _descriptor_6.fromValue(value_0),
      s: _descriptor_6.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_6.toValue(value_0.r).concat(_descriptor_6.toValue(value_0.s));
  }
}

const _descriptor_7 = new _Secp256k1EcdsaSignature_0();

const _descriptor_8 = new __compactRuntime.CompactTypeUnsignedInteger(255n, 1);

const _descriptor_9 = __compactRuntime.CompactTypeBoolean;

const _descriptor_10 = new __compactRuntime.CompactTypeUnsignedInteger(340282366920938463463374607431768211455n, 16);

const _descriptor_11 = new __compactRuntime.CompactTypeUnsignedInteger(4294967295n, 4);

class _GrantScope_0 {
  alignment() {
    return _descriptor_9.alignment().concat(_descriptor_9.alignment().concat(_descriptor_9.alignment().concat(_descriptor_9.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_10.alignment().concat(_descriptor_0.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_0.alignment().concat(_descriptor_10.alignment())))))))))));
  }
  fromValue(value_0) {
    return {
      op_withdraw_unshielded: _descriptor_9.fromValue(value_0),
      op_withdraw_shielded: _descriptor_9.fromValue(value_0),
      op_withdraw_shielded_to_contract: _descriptor_9.fromValue(value_0),
      read: _descriptor_9.fromValue(value_0),
      object_commit: _descriptor_1.fromValue(value_0),
      per_call_cap: _descriptor_10.fromValue(value_0),
      cap: _descriptor_10.fromValue(value_0),
      expires_at: _descriptor_0.fromValue(value_0),
      rp_commit: _descriptor_1.fromValue(value_0),
      read_pk_hash: _descriptor_1.fromValue(value_0),
      window_len: _descriptor_0.fromValue(value_0),
      window_cap: _descriptor_10.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_9.toValue(value_0.op_withdraw_unshielded).concat(_descriptor_9.toValue(value_0.op_withdraw_shielded).concat(_descriptor_9.toValue(value_0.op_withdraw_shielded_to_contract).concat(_descriptor_9.toValue(value_0.read).concat(_descriptor_1.toValue(value_0.object_commit).concat(_descriptor_10.toValue(value_0.per_call_cap).concat(_descriptor_10.toValue(value_0.cap).concat(_descriptor_0.toValue(value_0.expires_at).concat(_descriptor_1.toValue(value_0.rp_commit).concat(_descriptor_1.toValue(value_0.read_pk_hash).concat(_descriptor_0.toValue(value_0.window_len).concat(_descriptor_10.toValue(value_0.window_cap))))))))))));
  }
}

const _descriptor_12 = new _GrantScope_0();

class _GrantRecord_0 {
  alignment() {
    return _descriptor_11.alignment().concat(_descriptor_11.alignment().concat(_descriptor_0.alignment().concat(_descriptor_0.alignment().concat(_descriptor_1.alignment().concat(_descriptor_0.alignment().concat(_descriptor_10.alignment().concat(_descriptor_9.alignment().concat(_descriptor_12.alignment()))))))));
  }
  fromValue(value_0) {
    return {
      epoch: _descriptor_11.fromValue(value_0),
      gen: _descriptor_11.fromValue(value_0),
      issued_at: _descriptor_0.fromValue(value_0),
      nonce: _descriptor_0.fromValue(value_0),
      spent_commit: _descriptor_1.fromValue(value_0),
      window_start: _descriptor_0.fromValue(value_0),
      window_spent: _descriptor_10.fromValue(value_0),
      active: _descriptor_9.fromValue(value_0),
      scope: _descriptor_12.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_11.toValue(value_0.epoch).concat(_descriptor_11.toValue(value_0.gen).concat(_descriptor_0.toValue(value_0.issued_at).concat(_descriptor_0.toValue(value_0.nonce).concat(_descriptor_1.toValue(value_0.spent_commit).concat(_descriptor_0.toValue(value_0.window_start).concat(_descriptor_10.toValue(value_0.window_spent).concat(_descriptor_9.toValue(value_0.active).concat(_descriptor_12.toValue(value_0.scope)))))))));
  }
}

const _descriptor_13 = new _GrantRecord_0();

const _descriptor_14 = new __compactRuntime.CompactTypeBytes(192);

class _ShieldedCoinInfo_0 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment()));
  }
  fromValue(value_0) {
    return {
      nonce: _descriptor_1.fromValue(value_0),
      color: _descriptor_1.fromValue(value_0),
      value: _descriptor_10.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0.nonce).concat(_descriptor_1.toValue(value_0.color).concat(_descriptor_10.toValue(value_0.value)));
  }
}

const _descriptor_15 = new _ShieldedCoinInfo_0();

class _Maybe_0 {
  alignment() {
    return _descriptor_9.alignment().concat(_descriptor_15.alignment());
  }
  fromValue(value_0) {
    return {
      is_some: _descriptor_9.fromValue(value_0),
      value: _descriptor_15.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_9.toValue(value_0.is_some).concat(_descriptor_15.toValue(value_0.value));
  }
}

const _descriptor_16 = new _Maybe_0();

class _tuple_0 {
  alignment() {
    return _descriptor_15.alignment().concat(_descriptor_16.alignment());
  }
  fromValue(value_0) {
    return [
      _descriptor_15.fromValue(value_0),
      _descriptor_16.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_15.toValue(value_0[0]).concat(_descriptor_16.toValue(value_0[1]));
  }
}

const _descriptor_17 = new _tuple_0();

class _UserAddress_0 {
  alignment() {
    return _descriptor_1.alignment();
  }
  fromValue(value_0) {
    return {
      bytes: _descriptor_1.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0.bytes);
  }
}

const _descriptor_18 = new _UserAddress_0();

class _ZswapCoinPublicKey_0 {
  alignment() {
    return _descriptor_1.alignment();
  }
  fromValue(value_0) {
    return {
      bytes: _descriptor_1.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0.bytes);
  }
}

const _descriptor_19 = new _ZswapCoinPublicKey_0();

class _tuple_1 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_13.alignment());
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_13.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_13.toValue(value_0[1]));
  }
}

const _descriptor_20 = new _tuple_1();

class _QualifiedShieldedCoinInfo_0 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_0.alignment())));
  }
  fromValue(value_0) {
    return {
      nonce: _descriptor_1.fromValue(value_0),
      color: _descriptor_1.fromValue(value_0),
      value: _descriptor_10.fromValue(value_0),
      mt_index: _descriptor_0.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0.nonce).concat(_descriptor_1.toValue(value_0.color).concat(_descriptor_10.toValue(value_0.value).concat(_descriptor_0.toValue(value_0.mt_index))));
  }
}

const _descriptor_21 = new _QualifiedShieldedCoinInfo_0();

const _descriptor_22 = __compactRuntime.CompactTypeSecp256k1Base;

class _Either_0 {
  alignment() {
    return _descriptor_9.alignment().concat(_descriptor_19.alignment().concat(_descriptor_2.alignment()));
  }
  fromValue(value_0) {
    return {
      is_left: _descriptor_9.fromValue(value_0),
      left: _descriptor_19.fromValue(value_0),
      right: _descriptor_2.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_9.toValue(value_0.is_left).concat(_descriptor_19.toValue(value_0.left).concat(_descriptor_2.toValue(value_0.right)));
  }
}

const _descriptor_23 = new _Either_0();

const _descriptor_24 = __compactRuntime.CompactTypeField;

class _tuple_2 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_3.alignment().concat(_descriptor_0.alignment().concat(_descriptor_0.alignment())))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_0.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_3.toValue(value_0[2]).concat(_descriptor_3.toValue(value_0[3]).concat(_descriptor_0.toValue(value_0[4]).concat(_descriptor_0.toValue(value_0[5]))))));
  }
}

const _descriptor_25 = new _tuple_2();

const _descriptor_26 = new __compactRuntime.CompactTypeBytes(21);

class _CoinPreimage_0 {
  alignment() {
    return _descriptor_26.alignment().concat(_descriptor_15.alignment().concat(_descriptor_9.alignment().concat(_descriptor_1.alignment())));
  }
  fromValue(value_0) {
    return {
      domain_sep: _descriptor_26.fromValue(value_0),
      info: _descriptor_15.fromValue(value_0),
      dataType: _descriptor_9.fromValue(value_0),
      data: _descriptor_1.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_26.toValue(value_0.domain_sep).concat(_descriptor_15.toValue(value_0.info).concat(_descriptor_9.toValue(value_0.dataType).concat(_descriptor_1.toValue(value_0.data))));
  }
}

const _descriptor_27 = new _CoinPreimage_0();

class _tuple_3 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_3.alignment().concat(_descriptor_1.alignment().concat(_descriptor_0.alignment().concat(_descriptor_0.alignment()))))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_0.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_3.toValue(value_0[2]).concat(_descriptor_3.toValue(value_0[3]).concat(_descriptor_1.toValue(value_0[4]).concat(_descriptor_0.toValue(value_0[5]).concat(_descriptor_0.toValue(value_0[6])))))));
  }
}

const _descriptor_28 = new _tuple_3();

const _descriptor_29 = new __compactRuntime.CompactTypeBytes(64);

class _tuple_4 {
  alignment() {
    return _descriptor_29.alignment();
  }
  fromValue(value_0) {
    return [
      _descriptor_29.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_29.toValue(value_0[0]);
  }
}

const _descriptor_30 = new _tuple_4();

class _tuple_5 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_0.alignment()))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_1.toValue(value_0[2]).concat(_descriptor_1.toValue(value_0[3]).concat(_descriptor_0.toValue(value_0[4])))));
  }
}

const _descriptor_31 = new _tuple_5();

class _tuple_6 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_3.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_0.alignment().concat(_descriptor_0.alignment())))))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_0.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_3.toValue(value_0[2]).concat(_descriptor_3.toValue(value_0[3]).concat(_descriptor_1.toValue(value_0[4]).concat(_descriptor_1.toValue(value_0[5]).concat(_descriptor_0.toValue(value_0[6]).concat(_descriptor_0.toValue(value_0[7]))))))));
  }
}

const _descriptor_32 = new _tuple_6();

class _tuple_7 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_0.alignment()))))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_1.toValue(value_0[2]).concat(_descriptor_1.toValue(value_0[3]).concat(_descriptor_1.toValue(value_0[4]).concat(_descriptor_1.toValue(value_0[5]).concat(_descriptor_0.toValue(value_0[6])))))));
  }
}

const _descriptor_33 = new _tuple_7();

class _tuple_8 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_0.alignment())))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_1.toValue(value_0[2]).concat(_descriptor_1.toValue(value_0[3]).concat(_descriptor_1.toValue(value_0[4]).concat(_descriptor_0.toValue(value_0[5]))))));
  }
}

const _descriptor_34 = new _tuple_8();

class _tuple_9 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_3.alignment().concat(_descriptor_1.alignment().concat(_descriptor_0.alignment().concat(_descriptor_19.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_14.alignment().concat(_descriptor_1.alignment().concat(_descriptor_21.alignment().concat(_descriptor_0.alignment().concat(_descriptor_0.alignment())))))))))))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_0.fromValue(value_0),
      _descriptor_19.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_10.fromValue(value_0),
      _descriptor_14.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_21.fromValue(value_0),
      _descriptor_0.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_3.toValue(value_0[2]).concat(_descriptor_3.toValue(value_0[3]).concat(_descriptor_1.toValue(value_0[4]).concat(_descriptor_0.toValue(value_0[5]).concat(_descriptor_19.toValue(value_0[6]).concat(_descriptor_1.toValue(value_0[7]).concat(_descriptor_10.toValue(value_0[8]).concat(_descriptor_14.toValue(value_0[9]).concat(_descriptor_1.toValue(value_0[10]).concat(_descriptor_21.toValue(value_0[11]).concat(_descriptor_0.toValue(value_0[12]).concat(_descriptor_0.toValue(value_0[13]))))))))))))));
  }
}

const _descriptor_35 = new _tuple_9();

class _tuple_10 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_3.alignment().concat(_descriptor_1.alignment().concat(_descriptor_0.alignment().concat(_descriptor_2.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_14.alignment().concat(_descriptor_1.alignment().concat(_descriptor_21.alignment().concat(_descriptor_0.alignment().concat(_descriptor_0.alignment())))))))))))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_0.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_10.fromValue(value_0),
      _descriptor_14.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_21.fromValue(value_0),
      _descriptor_0.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_3.toValue(value_0[2]).concat(_descriptor_3.toValue(value_0[3]).concat(_descriptor_1.toValue(value_0[4]).concat(_descriptor_0.toValue(value_0[5]).concat(_descriptor_2.toValue(value_0[6]).concat(_descriptor_1.toValue(value_0[7]).concat(_descriptor_10.toValue(value_0[8]).concat(_descriptor_14.toValue(value_0[9]).concat(_descriptor_1.toValue(value_0[10]).concat(_descriptor_21.toValue(value_0[11]).concat(_descriptor_0.toValue(value_0[12]).concat(_descriptor_0.toValue(value_0[13]))))))))))))));
  }
}

const _descriptor_36 = new _tuple_10();

class _tuple_11 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_0.alignment().concat(_descriptor_2.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_14.alignment().concat(_descriptor_1.alignment().concat(_descriptor_21.alignment().concat(_descriptor_0.alignment()))))))))))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_0.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_10.fromValue(value_0),
      _descriptor_14.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_21.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_1.toValue(value_0[2]).concat(_descriptor_1.toValue(value_0[3]).concat(_descriptor_1.toValue(value_0[4]).concat(_descriptor_0.toValue(value_0[5]).concat(_descriptor_2.toValue(value_0[6]).concat(_descriptor_1.toValue(value_0[7]).concat(_descriptor_10.toValue(value_0[8]).concat(_descriptor_14.toValue(value_0[9]).concat(_descriptor_1.toValue(value_0[10]).concat(_descriptor_21.toValue(value_0[11]).concat(_descriptor_0.toValue(value_0[12])))))))))))));
  }
}

const _descriptor_37 = new _tuple_11();

class _tuple_12 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_3.alignment().concat(_descriptor_1.alignment().concat(_descriptor_0.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_18.alignment().concat(_descriptor_0.alignment().concat(_descriptor_0.alignment()))))))))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_0.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_10.fromValue(value_0),
      _descriptor_18.fromValue(value_0),
      _descriptor_0.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_3.toValue(value_0[2]).concat(_descriptor_3.toValue(value_0[3]).concat(_descriptor_1.toValue(value_0[4]).concat(_descriptor_0.toValue(value_0[5]).concat(_descriptor_1.toValue(value_0[6]).concat(_descriptor_10.toValue(value_0[7]).concat(_descriptor_18.toValue(value_0[8]).concat(_descriptor_0.toValue(value_0[9]).concat(_descriptor_0.toValue(value_0[10])))))))))));
  }
}

const _descriptor_38 = new _tuple_12();

class _tuple_13 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_0.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_18.alignment().concat(_descriptor_0.alignment())))))))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_0.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_10.fromValue(value_0),
      _descriptor_18.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_1.toValue(value_0[2]).concat(_descriptor_1.toValue(value_0[3]).concat(_descriptor_1.toValue(value_0[4]).concat(_descriptor_0.toValue(value_0[5]).concat(_descriptor_1.toValue(value_0[6]).concat(_descriptor_10.toValue(value_0[7]).concat(_descriptor_18.toValue(value_0[8]).concat(_descriptor_0.toValue(value_0[9]))))))))));
  }
}

const _descriptor_39 = new _tuple_13();

class _tuple_14 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_0.alignment().concat(_descriptor_19.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_14.alignment().concat(_descriptor_1.alignment().concat(_descriptor_21.alignment().concat(_descriptor_0.alignment()))))))))))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_0.fromValue(value_0),
      _descriptor_19.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_10.fromValue(value_0),
      _descriptor_14.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_21.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_1.toValue(value_0[2]).concat(_descriptor_1.toValue(value_0[3]).concat(_descriptor_1.toValue(value_0[4]).concat(_descriptor_0.toValue(value_0[5]).concat(_descriptor_19.toValue(value_0[6]).concat(_descriptor_1.toValue(value_0[7]).concat(_descriptor_10.toValue(value_0[8]).concat(_descriptor_14.toValue(value_0[9]).concat(_descriptor_1.toValue(value_0[10]).concat(_descriptor_21.toValue(value_0[11]).concat(_descriptor_0.toValue(value_0[12])))))))))))));
  }
}

const _descriptor_40 = new _tuple_14();

class _tuple_15 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment()));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_1.toValue(value_0[1]).concat(_descriptor_1.toValue(value_0[2])));
  }
}

const _descriptor_41 = new _tuple_15();

class _tuple_16 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_9.alignment().concat(_descriptor_9.alignment().concat(_descriptor_9.alignment().concat(_descriptor_9.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_10.alignment().concat(_descriptor_10.alignment().concat(_descriptor_0.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_0.alignment().concat(_descriptor_10.alignment()))))))))))))))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_9.fromValue(value_0),
      _descriptor_9.fromValue(value_0),
      _descriptor_9.fromValue(value_0),
      _descriptor_9.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_8.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_10.fromValue(value_0),
      _descriptor_10.fromValue(value_0),
      _descriptor_10.fromValue(value_0),
      _descriptor_0.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_0.fromValue(value_0),
      _descriptor_10.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_1.toValue(value_0[1]).concat(_descriptor_9.toValue(value_0[2]).concat(_descriptor_9.toValue(value_0[3]).concat(_descriptor_9.toValue(value_0[4]).concat(_descriptor_9.toValue(value_0[5]).concat(_descriptor_1.toValue(value_0[6]).concat(_descriptor_8.toValue(value_0[7]).concat(_descriptor_1.toValue(value_0[8]).concat(_descriptor_10.toValue(value_0[9]).concat(_descriptor_10.toValue(value_0[10]).concat(_descriptor_10.toValue(value_0[11]).concat(_descriptor_0.toValue(value_0[12]).concat(_descriptor_1.toValue(value_0[13]).concat(_descriptor_1.toValue(value_0[14]).concat(_descriptor_0.toValue(value_0[15]).concat(_descriptor_10.toValue(value_0[16])))))))))))))))));
  }
}

const _descriptor_42 = new _tuple_16();

class _tuple_17 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment())))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_8.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_10.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_1.toValue(value_0[1]).concat(_descriptor_1.toValue(value_0[2]).concat(_descriptor_8.toValue(value_0[3]).concat(_descriptor_1.toValue(value_0[4]).concat(_descriptor_10.toValue(value_0[5]))))));
  }
}

const _descriptor_43 = new _tuple_17();

class _tuple_18 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment()));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_10.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_1.toValue(value_0[1]).concat(_descriptor_10.toValue(value_0[2])));
  }
}

const _descriptor_44 = new _tuple_18();

class _tuple_19 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment()))))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_8.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_8.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_1.toValue(value_0[2]).concat(_descriptor_1.toValue(value_0[3]).concat(_descriptor_8.toValue(value_0[4]).concat(_descriptor_1.toValue(value_0[5]).concat(_descriptor_8.toValue(value_0[6])))))));
  }
}

const _descriptor_45 = new _tuple_19();

class _tuple_20 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment()))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_8.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_3.toValue(value_0[2]).concat(_descriptor_1.toValue(value_0[3]).concat(_descriptor_8.toValue(value_0[4])))));
  }
}

const _descriptor_46 = new _tuple_20();

class _tuple_21 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_21.alignment().concat(_descriptor_0.alignment()))))))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_10.fromValue(value_0),
      _descriptor_21.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_1.toValue(value_0[2]).concat(_descriptor_1.toValue(value_0[3]).concat(_descriptor_2.toValue(value_0[4]).concat(_descriptor_1.toValue(value_0[5]).concat(_descriptor_10.toValue(value_0[6]).concat(_descriptor_21.toValue(value_0[7]).concat(_descriptor_0.toValue(value_0[8])))))))));
  }
}

const _descriptor_47 = new _tuple_21();

class _tuple_22 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_14.alignment().concat(_descriptor_0.alignment())))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_14.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_1.toValue(value_0[2]).concat(_descriptor_1.toValue(value_0[3]).concat(_descriptor_14.toValue(value_0[4]).concat(_descriptor_0.toValue(value_0[5]))))));
  }
}

const _descriptor_48 = new _tuple_22();

class _tuple_23 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_18.alignment().concat(_descriptor_0.alignment())))))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_10.fromValue(value_0),
      _descriptor_18.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_1.toValue(value_0[2]).concat(_descriptor_1.toValue(value_0[3]).concat(_descriptor_1.toValue(value_0[4]).concat(_descriptor_10.toValue(value_0[5]).concat(_descriptor_18.toValue(value_0[6]).concat(_descriptor_0.toValue(value_0[7]))))))));
  }
}

const _descriptor_49 = new _tuple_23();

class _tuple_24 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_19.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_21.alignment().concat(_descriptor_0.alignment()))))))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_19.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_10.fromValue(value_0),
      _descriptor_21.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_1.toValue(value_0[2]).concat(_descriptor_1.toValue(value_0[3]).concat(_descriptor_19.toValue(value_0[4]).concat(_descriptor_1.toValue(value_0[5]).concat(_descriptor_10.toValue(value_0[6]).concat(_descriptor_21.toValue(value_0[7]).concat(_descriptor_0.toValue(value_0[8])))))))));
  }
}

const _descriptor_50 = new _tuple_24();

class _tuple_25 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_3.alignment().concat(_descriptor_2.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_21.alignment().concat(_descriptor_0.alignment().concat(_descriptor_0.alignment())))))))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_10.fromValue(value_0),
      _descriptor_21.fromValue(value_0),
      _descriptor_0.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_3.toValue(value_0[2]).concat(_descriptor_3.toValue(value_0[3]).concat(_descriptor_2.toValue(value_0[4]).concat(_descriptor_1.toValue(value_0[5]).concat(_descriptor_10.toValue(value_0[6]).concat(_descriptor_21.toValue(value_0[7]).concat(_descriptor_0.toValue(value_0[8]).concat(_descriptor_0.toValue(value_0[9]))))))))));
  }
}

const _descriptor_51 = new _tuple_25();

class _tuple_26 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_3.alignment().concat(_descriptor_14.alignment().concat(_descriptor_0.alignment().concat(_descriptor_0.alignment()))))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_14.fromValue(value_0),
      _descriptor_0.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_3.toValue(value_0[2]).concat(_descriptor_3.toValue(value_0[3]).concat(_descriptor_14.toValue(value_0[4]).concat(_descriptor_0.toValue(value_0[5]).concat(_descriptor_0.toValue(value_0[6])))))));
  }
}

const _descriptor_52 = new _tuple_26();

class _tuple_27 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_3.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_18.alignment().concat(_descriptor_0.alignment().concat(_descriptor_0.alignment()))))))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_10.fromValue(value_0),
      _descriptor_18.fromValue(value_0),
      _descriptor_0.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_3.toValue(value_0[2]).concat(_descriptor_3.toValue(value_0[3]).concat(_descriptor_1.toValue(value_0[4]).concat(_descriptor_10.toValue(value_0[5]).concat(_descriptor_18.toValue(value_0[6]).concat(_descriptor_0.toValue(value_0[7]).concat(_descriptor_0.toValue(value_0[8])))))))));
  }
}

const _descriptor_53 = new _tuple_27();

class _tuple_28 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_3.alignment().concat(_descriptor_19.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_21.alignment().concat(_descriptor_0.alignment().concat(_descriptor_0.alignment())))))))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_19.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_10.fromValue(value_0),
      _descriptor_21.fromValue(value_0),
      _descriptor_0.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_3.toValue(value_0[2]).concat(_descriptor_3.toValue(value_0[3]).concat(_descriptor_19.toValue(value_0[4]).concat(_descriptor_1.toValue(value_0[5]).concat(_descriptor_10.toValue(value_0[6]).concat(_descriptor_21.toValue(value_0[7]).concat(_descriptor_0.toValue(value_0[8]).concat(_descriptor_0.toValue(value_0[9]))))))))));
  }
}

const _descriptor_54 = new _tuple_28();

const _descriptor_55 = new __compactRuntime.CompactTypeBytes(27);

class _tuple_29 {
  alignment() {
    return _descriptor_55.alignment().concat(_descriptor_1.alignment());
  }
  fromValue(value_0) {
    return [
      _descriptor_55.fromValue(value_0),
      _descriptor_1.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_55.toValue(value_0[0]).concat(_descriptor_1.toValue(value_0[1]));
  }
}

const _descriptor_56 = new _tuple_29();

class _tuple_30 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_11.alignment().concat(_descriptor_0.alignment()))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_3.fromValue(value_0),
      _descriptor_11.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_3.toValue(value_0[2]).concat(_descriptor_11.toValue(value_0[3]).concat(_descriptor_0.toValue(value_0[4])))));
  }
}

const _descriptor_57 = new _tuple_30();

class _tuple_31 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_2.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment().concat(_descriptor_11.alignment().concat(_descriptor_0.alignment()))))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_2.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_8.fromValue(value_0),
      _descriptor_11.fromValue(value_0),
      _descriptor_0.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_2.toValue(value_0[1]).concat(_descriptor_1.toValue(value_0[2]).concat(_descriptor_1.toValue(value_0[3]).concat(_descriptor_8.toValue(value_0[4]).concat(_descriptor_11.toValue(value_0[5]).concat(_descriptor_0.toValue(value_0[6])))))));
  }
}

const _descriptor_58 = new _tuple_31();

class _tuple_32 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_3.alignment()));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_3.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_1.toValue(value_0[1]).concat(_descriptor_3.toValue(value_0[2])));
  }
}

const _descriptor_59 = new _tuple_32();

class _tuple_33 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment()))));
  }
  fromValue(value_0) {
    return [
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_1.fromValue(value_0),
      _descriptor_8.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0[0]).concat(_descriptor_1.toValue(value_0[1]).concat(_descriptor_1.toValue(value_0[2]).concat(_descriptor_1.toValue(value_0[3]).concat(_descriptor_8.toValue(value_0[4])))));
  }
}

const _descriptor_60 = new _tuple_33();

const _descriptor_61 = new __compactRuntime.CompactTypeVector(2, _descriptor_4);

class _Either_1 {
  alignment() {
    return _descriptor_9.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment()));
  }
  fromValue(value_0) {
    return {
      is_left: _descriptor_9.fromValue(value_0),
      left: _descriptor_1.fromValue(value_0),
      right: _descriptor_1.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_9.toValue(value_0.is_left).concat(_descriptor_1.toValue(value_0.left).concat(_descriptor_1.toValue(value_0.right)));
  }
}

const _descriptor_62 = new _Either_1();

class _Either_2 {
  alignment() {
    return _descriptor_9.alignment().concat(_descriptor_2.alignment().concat(_descriptor_18.alignment()));
  }
  fromValue(value_0) {
    return {
      is_left: _descriptor_9.fromValue(value_0),
      left: _descriptor_2.fromValue(value_0),
      right: _descriptor_18.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_9.toValue(value_0.is_left).concat(_descriptor_2.toValue(value_0.left).concat(_descriptor_18.toValue(value_0.right)));
  }
}

const _descriptor_63 = new _Either_2();

class _ShieldedSendResult_0 {
  alignment() {
    return _descriptor_16.alignment().concat(_descriptor_15.alignment());
  }
  fromValue(value_0) {
    return {
      change: _descriptor_16.fromValue(value_0),
      sent: _descriptor_15.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_16.toValue(value_0.change).concat(_descriptor_15.toValue(value_0.sent));
  }
}

const _descriptor_64 = new _ShieldedSendResult_0();

export class Contract {
  witnesses;
  constructor(...args_0) {
    if (args_0.length !== 1) {
      throw new __compactRuntime.CompactError(`Contract constructor: expected 1 argument, received ${args_0.length}`);
    }
    const witnesses_0 = args_0[0];
    if (typeof(witnesses_0) !== 'object') {
      throw new __compactRuntime.CompactError('first (witnesses) argument to Contract constructor is not an object');
    }
    if (typeof(witnesses_0.held_coin) !== 'function') {
      throw new __compactRuntime.CompactError('first (witnesses) argument to Contract constructor does not contain a function-valued field named held_coin');
    }
    this.witnesses = witnesses_0;
    this.circuits = {
      activate_initial_device_with_jubjub: async (...args_1) => {
        if (args_1.length !== 3) {
          throw new __compactRuntime.CompactError(`activate_initial_device_with_jubjub: expected 3 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const pk_0 = args_1[1];
        const salt_0 = args_1[2];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('activate_initial_device_with_jubjub',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 321 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
          __compactRuntime.typeError('activate_initial_device_with_jubjub',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 321 char 1',
                                     'JubjubPoint',
                                     pk_0)
        }
        if (!(salt_0.buffer instanceof ArrayBuffer && salt_0.BYTES_PER_ELEMENT === 1 && salt_0.length === 32)) {
          __compactRuntime.typeError('activate_initial_device_with_jubjub',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 321 char 1',
                                     'Bytes<32>',
                                     salt_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_3.toValue(pk_0).concat(_descriptor_1.toValue(salt_0)),
            alignment: _descriptor_3.alignment().concat(_descriptor_1.alignment())
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._activate_initial_device_with_jubjub_0(context,
                                                                           partialProofData,
                                                                           pk_0,
                                                                           salt_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      activate_initial_device_with_k256: async (...args_1) => {
        if (args_1.length !== 4) {
          throw new __compactRuntime.CompactError(`activate_initial_device_with_k256: expected 4 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const pk_0 = args_1[1];
        const salt_0 = args_1[2];
        const envelope_0 = args_1[3];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('activate_initial_device_with_k256',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 331 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
          __compactRuntime.typeError('activate_initial_device_with_k256',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 331 char 1',
                                     'Secp256k1Point',
                                     pk_0)
        }
        if (!(salt_0.buffer instanceof ArrayBuffer && salt_0.BYTES_PER_ELEMENT === 1 && salt_0.length === 32)) {
          __compactRuntime.typeError('activate_initial_device_with_k256',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 331 char 1',
                                     'Bytes<32>',
                                     salt_0)
        }
        if (!(typeof(envelope_0) === 'bigint' && envelope_0 >= 0n && envelope_0 <= 255n)) {
          __compactRuntime.typeError('activate_initial_device_with_k256',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 331 char 1',
                                     'Uint<0..256>',
                                     envelope_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_5.toValue(pk_0).concat(_descriptor_1.toValue(salt_0).concat(_descriptor_8.toValue(envelope_0))),
            alignment: _descriptor_5.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment()))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._activate_initial_device_with_k256_0(context,
                                                                         partialProofData,
                                                                         pk_0,
                                                                         salt_0,
                                                                         envelope_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      async derive_boot_commitment_with_jubjub(context, ...args_1) {
        return { result: pureCircuits.derive_boot_commitment_with_jubjub(...args_1), context };
      },
      async derive_boot_commitment_with_k256(context, ...args_1) {
        return { result: pureCircuits.derive_boot_commitment_with_k256(...args_1), context };
      },
      async derive_device_entry_with_jubjub(context, ...args_1) {
        return { result: pureCircuits.derive_device_entry_with_jubjub(...args_1), context };
      },
      async derive_device_entry_with_k256(context, ...args_1) {
        return { result: pureCircuits.derive_device_entry_with_k256(...args_1), context };
      },
      async envelope_digest(context, ...args_1) {
        return { result: pureCircuits.envelope_digest(...args_1), context };
      },
      async compute_public_point_with_jubjub(context, ...args_1) {
        return { result: pureCircuits.compute_public_point_with_jubjub(...args_1), context };
      },
      async compute_public_point_with_k256(context, ...args_1) {
        return { result: pureCircuits.compute_public_point_with_k256(...args_1), context };
      },
      async challenge_withdraw_unshielded_with_jubjub(context, ...args_1) {
        return { result: pureCircuits.challenge_withdraw_unshielded_with_jubjub(...args_1), context };
      },
      async challenge_withdraw_shielded_with_jubjub(context, ...args_1) {
        return { result: pureCircuits.challenge_withdraw_shielded_with_jubjub(...args_1), context };
      },
      async challenge_withdraw_shielded_to_contract_with_jubjub(context, ...args_1) {
        return { result: pureCircuits.challenge_withdraw_shielded_to_contract_with_jubjub(...args_1), context };
      },
      async challenge_append_inbox_with_jubjub(context, ...args_1) {
        return { result: pureCircuits.challenge_append_inbox_with_jubjub(...args_1), context };
      },
      async challenge_rotate_enc_key_with_jubjub(context, ...args_1) {
        return { result: pureCircuits.challenge_rotate_enc_key_with_jubjub(...args_1), context };
      },
      async challenge_add_device_with_jubjub(context, ...args_1) {
        return { result: pureCircuits.challenge_add_device_with_jubjub(...args_1), context };
      },
      async challenge_remove_device_with_jubjub(context, ...args_1) {
        return { result: pureCircuits.challenge_remove_device_with_jubjub(...args_1), context };
      },
      async challenge_withdraw_unshielded_with_k256(context, ...args_1) {
        return { result: pureCircuits.challenge_withdraw_unshielded_with_k256(...args_1), context };
      },
      async challenge_withdraw_shielded_with_k256(context, ...args_1) {
        return { result: pureCircuits.challenge_withdraw_shielded_with_k256(...args_1), context };
      },
      async challenge_withdraw_shielded_to_contract_with_k256(context, ...args_1) {
        return { result: pureCircuits.challenge_withdraw_shielded_to_contract_with_k256(...args_1), context };
      },
      async challenge_append_inbox_with_k256(context, ...args_1) {
        return { result: pureCircuits.challenge_append_inbox_with_k256(...args_1), context };
      },
      async challenge_rotate_enc_key_with_k256(context, ...args_1) {
        return { result: pureCircuits.challenge_rotate_enc_key_with_k256(...args_1), context };
      },
      async challenge_add_device_with_k256(context, ...args_1) {
        return { result: pureCircuits.challenge_add_device_with_k256(...args_1), context };
      },
      async challenge_remove_device_with_k256(context, ...args_1) {
        return { result: pureCircuits.challenge_remove_device_with_k256(...args_1), context };
      },
      deposit_unshielded: async (...args_1) => {
        if (args_1.length !== 3) {
          throw new __compactRuntime.CompactError(`deposit_unshielded: expected 3 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const color_0 = args_1[1];
        const amount_0 = args_1[2];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('deposit_unshielded',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 960 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
          __compactRuntime.typeError('deposit_unshielded',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 960 char 1',
                                     'Bytes<32>',
                                     color_0)
        }
        if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('deposit_unshielded',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 960 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     amount_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_1.toValue(color_0).concat(_descriptor_10.toValue(amount_0)),
            alignment: _descriptor_1.alignment().concat(_descriptor_10.alignment())
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._deposit_unshielded_0(context,
                                                          partialProofData,
                                                          color_0,
                                                          amount_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      withdraw_unshielded_with_jubjub: async (...args_1) => {
        if (args_1.length !== 9) {
          throw new __compactRuntime.CompactError(`withdraw_unshielded_with_jubjub: expected 9 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const color_0 = args_1[1];
        const amount_0 = args_1[2];
        const recipient_0 = args_1[3];
        const pk_0 = args_1[4];
        const use_counter_0 = args_1[5];
        const sig_r_0 = args_1[6];
        const sig_s_0 = args_1[7];
        const grind_nonce_0 = args_1[8];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('withdraw_unshielded_with_jubjub',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 970 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
          __compactRuntime.typeError('withdraw_unshielded_with_jubjub',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 970 char 1',
                                     'Bytes<32>',
                                     color_0)
        }
        if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_unshielded_with_jubjub',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 970 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     amount_0)
        }
        if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
          __compactRuntime.typeError('withdraw_unshielded_with_jubjub',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 970 char 1',
                                     'struct UserAddress<bytes: Bytes<32>>',
                                     recipient_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
          __compactRuntime.typeError('withdraw_unshielded_with_jubjub',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 970 char 1',
                                     'JubjubPoint',
                                     pk_0)
        }
        if (!(typeof(use_counter_0) === 'bigint' && use_counter_0 >= 0n && use_counter_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('withdraw_unshielded_with_jubjub',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 970 char 1',
                                     'Uint<0..18446744073709551616>',
                                     use_counter_0)
        }
        if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
          __compactRuntime.typeError('withdraw_unshielded_with_jubjub',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'account.compact line 970 char 1',
                                     'JubjubPoint',
                                     sig_r_0)
        }
        if (!(typeof(sig_s_0) === 'bigint' && sig_s_0 >= 0 && sig_s_0 <= __compactRuntime.MAX_FIELD)) {
          __compactRuntime.typeError('withdraw_unshielded_with_jubjub',
                                     'argument 7 (argument 8 as invoked from Typescript)',
                                     'account.compact line 970 char 1',
                                     'Field',
                                     sig_s_0)
        }
        if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('withdraw_unshielded_with_jubjub',
                                     'argument 8 (argument 9 as invoked from Typescript)',
                                     'account.compact line 970 char 1',
                                     'Uint<0..18446744073709551616>',
                                     grind_nonce_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_1.toValue(color_0).concat(_descriptor_10.toValue(amount_0).concat(_descriptor_18.toValue(recipient_0).concat(_descriptor_3.toValue(pk_0).concat(_descriptor_0.toValue(use_counter_0).concat(_descriptor_3.toValue(sig_r_0).concat(_descriptor_4.toValue(sig_s_0).concat(_descriptor_0.toValue(grind_nonce_0)))))))),
            alignment: _descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_18.alignment().concat(_descriptor_3.alignment().concat(_descriptor_0.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment().concat(_descriptor_0.alignment())))))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._withdraw_unshielded_with_jubjub_0(context,
                                                                       partialProofData,
                                                                       color_0,
                                                                       amount_0,
                                                                       recipient_0,
                                                                       pk_0,
                                                                       use_counter_0,
                                                                       sig_r_0,
                                                                       sig_s_0,
                                                                       grind_nonce_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      withdraw_unshielded_with_k256: async (...args_1) => {
        if (args_1.length !== 8) {
          throw new __compactRuntime.CompactError(`withdraw_unshielded_with_k256: expected 8 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const color_0 = args_1[1];
        const amount_0 = args_1[2];
        const recipient_0 = args_1[3];
        const pk_0 = args_1[4];
        const use_counter_0 = args_1[5];
        const sig_0 = args_1[6];
        const envelope_0 = args_1[7];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('withdraw_unshielded_with_k256',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 987 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
          __compactRuntime.typeError('withdraw_unshielded_with_k256',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 987 char 1',
                                     'Bytes<32>',
                                     color_0)
        }
        if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_unshielded_with_k256',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 987 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     amount_0)
        }
        if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
          __compactRuntime.typeError('withdraw_unshielded_with_k256',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 987 char 1',
                                     'struct UserAddress<bytes: Bytes<32>>',
                                     recipient_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
          __compactRuntime.typeError('withdraw_unshielded_with_k256',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 987 char 1',
                                     'Secp256k1Point',
                                     pk_0)
        }
        if (!(typeof(use_counter_0) === 'bigint' && use_counter_0 >= 0n && use_counter_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('withdraw_unshielded_with_k256',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 987 char 1',
                                     'Uint<0..18446744073709551616>',
                                     use_counter_0)
        }
        if (!(typeof(sig_0) === 'object' && typeof(sig_0.r) === 'bigint' && sig_0.r >= 0 && sig_0.r <= __compactRuntime.MAX_SECP256K1_SCALAR && typeof(sig_0.s) === 'bigint' && sig_0.s >= 0 && sig_0.s <= __compactRuntime.MAX_SECP256K1_SCALAR)) {
          __compactRuntime.typeError('withdraw_unshielded_with_k256',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'account.compact line 987 char 1',
                                     'struct Secp256k1EcdsaSignature<r: Secp256k1Scalar, s: Secp256k1Scalar>',
                                     sig_0)
        }
        if (!(typeof(envelope_0) === 'bigint' && envelope_0 >= 0n && envelope_0 <= 255n)) {
          __compactRuntime.typeError('withdraw_unshielded_with_k256',
                                     'argument 7 (argument 8 as invoked from Typescript)',
                                     'account.compact line 987 char 1',
                                     'Uint<0..256>',
                                     envelope_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_1.toValue(color_0).concat(_descriptor_10.toValue(amount_0).concat(_descriptor_18.toValue(recipient_0).concat(_descriptor_5.toValue(pk_0).concat(_descriptor_0.toValue(use_counter_0).concat(_descriptor_7.toValue(sig_0).concat(_descriptor_8.toValue(envelope_0))))))),
            alignment: _descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_18.alignment().concat(_descriptor_5.alignment().concat(_descriptor_0.alignment().concat(_descriptor_7.alignment().concat(_descriptor_8.alignment()))))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._withdraw_unshielded_with_k256_0(context,
                                                                     partialProofData,
                                                                     color_0,
                                                                     amount_0,
                                                                     recipient_0,
                                                                     pk_0,
                                                                     use_counter_0,
                                                                     sig_0,
                                                                     envelope_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      deposit_shielded: async (...args_1) => {
        if (args_1.length !== 3) {
          throw new __compactRuntime.CompactError(`deposit_shielded: expected 3 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const coin_0 = args_1[1];
        const entry_0 = args_1[2];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('deposit_shielded',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 1009 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(coin_0) === 'object' && coin_0.nonce.buffer instanceof ArrayBuffer && coin_0.nonce.BYTES_PER_ELEMENT === 1 && coin_0.nonce.length === 32 && coin_0.color.buffer instanceof ArrayBuffer && coin_0.color.BYTES_PER_ELEMENT === 1 && coin_0.color.length === 32 && typeof(coin_0.value) === 'bigint' && coin_0.value >= 0n && coin_0.value <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('deposit_shielded',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 1009 char 1',
                                     'struct ShieldedCoinInfo<nonce: Bytes<32>, color: Bytes<32>, value: Uint<0..340282366920938463463374607431768211456>>',
                                     coin_0)
        }
        if (!(entry_0.buffer instanceof ArrayBuffer && entry_0.BYTES_PER_ELEMENT === 1 && entry_0.length === 192)) {
          __compactRuntime.typeError('deposit_shielded',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 1009 char 1',
                                     'Bytes<192>',
                                     entry_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_15.toValue(coin_0).concat(_descriptor_14.toValue(entry_0)),
            alignment: _descriptor_15.alignment().concat(_descriptor_14.alignment())
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._deposit_shielded_0(context,
                                                        partialProofData,
                                                        coin_0,
                                                        entry_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      append_inbox_with_jubjub: async (...args_1) => {
        if (args_1.length !== 7) {
          throw new __compactRuntime.CompactError(`append_inbox_with_jubjub: expected 7 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const entry_0 = args_1[1];
        const pk_0 = args_1[2];
        const use_counter_0 = args_1[3];
        const sig_r_0 = args_1[4];
        const sig_s_0 = args_1[5];
        const grind_nonce_0 = args_1[6];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('append_inbox_with_jubjub',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 1020 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(entry_0.buffer instanceof ArrayBuffer && entry_0.BYTES_PER_ELEMENT === 1 && entry_0.length === 192)) {
          __compactRuntime.typeError('append_inbox_with_jubjub',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 1020 char 1',
                                     'Bytes<192>',
                                     entry_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
          __compactRuntime.typeError('append_inbox_with_jubjub',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 1020 char 1',
                                     'JubjubPoint',
                                     pk_0)
        }
        if (!(typeof(use_counter_0) === 'bigint' && use_counter_0 >= 0n && use_counter_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('append_inbox_with_jubjub',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 1020 char 1',
                                     'Uint<0..18446744073709551616>',
                                     use_counter_0)
        }
        if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
          __compactRuntime.typeError('append_inbox_with_jubjub',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 1020 char 1',
                                     'JubjubPoint',
                                     sig_r_0)
        }
        if (!(typeof(sig_s_0) === 'bigint' && sig_s_0 >= 0 && sig_s_0 <= __compactRuntime.MAX_FIELD)) {
          __compactRuntime.typeError('append_inbox_with_jubjub',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 1020 char 1',
                                     'Field',
                                     sig_s_0)
        }
        if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('append_inbox_with_jubjub',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'account.compact line 1020 char 1',
                                     'Uint<0..18446744073709551616>',
                                     grind_nonce_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_14.toValue(entry_0).concat(_descriptor_3.toValue(pk_0).concat(_descriptor_0.toValue(use_counter_0).concat(_descriptor_3.toValue(sig_r_0).concat(_descriptor_4.toValue(sig_s_0).concat(_descriptor_0.toValue(grind_nonce_0)))))),
            alignment: _descriptor_14.alignment().concat(_descriptor_3.alignment().concat(_descriptor_0.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment().concat(_descriptor_0.alignment())))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._append_inbox_with_jubjub_0(context,
                                                                partialProofData,
                                                                entry_0,
                                                                pk_0,
                                                                use_counter_0,
                                                                sig_r_0,
                                                                sig_s_0,
                                                                grind_nonce_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      append_inbox_with_k256: async (...args_1) => {
        if (args_1.length !== 6) {
          throw new __compactRuntime.CompactError(`append_inbox_with_k256: expected 6 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const entry_0 = args_1[1];
        const pk_0 = args_1[2];
        const use_counter_0 = args_1[3];
        const sig_0 = args_1[4];
        const envelope_0 = args_1[5];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('append_inbox_with_k256',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 1035 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(entry_0.buffer instanceof ArrayBuffer && entry_0.BYTES_PER_ELEMENT === 1 && entry_0.length === 192)) {
          __compactRuntime.typeError('append_inbox_with_k256',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 1035 char 1',
                                     'Bytes<192>',
                                     entry_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
          __compactRuntime.typeError('append_inbox_with_k256',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 1035 char 1',
                                     'Secp256k1Point',
                                     pk_0)
        }
        if (!(typeof(use_counter_0) === 'bigint' && use_counter_0 >= 0n && use_counter_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('append_inbox_with_k256',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 1035 char 1',
                                     'Uint<0..18446744073709551616>',
                                     use_counter_0)
        }
        if (!(typeof(sig_0) === 'object' && typeof(sig_0.r) === 'bigint' && sig_0.r >= 0 && sig_0.r <= __compactRuntime.MAX_SECP256K1_SCALAR && typeof(sig_0.s) === 'bigint' && sig_0.s >= 0 && sig_0.s <= __compactRuntime.MAX_SECP256K1_SCALAR)) {
          __compactRuntime.typeError('append_inbox_with_k256',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 1035 char 1',
                                     'struct Secp256k1EcdsaSignature<r: Secp256k1Scalar, s: Secp256k1Scalar>',
                                     sig_0)
        }
        if (!(typeof(envelope_0) === 'bigint' && envelope_0 >= 0n && envelope_0 <= 255n)) {
          __compactRuntime.typeError('append_inbox_with_k256',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 1035 char 1',
                                     'Uint<0..256>',
                                     envelope_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_14.toValue(entry_0).concat(_descriptor_5.toValue(pk_0).concat(_descriptor_0.toValue(use_counter_0).concat(_descriptor_7.toValue(sig_0).concat(_descriptor_8.toValue(envelope_0))))),
            alignment: _descriptor_14.alignment().concat(_descriptor_5.alignment().concat(_descriptor_0.alignment().concat(_descriptor_7.alignment().concat(_descriptor_8.alignment()))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._append_inbox_with_k256_0(context,
                                                              partialProofData,
                                                              entry_0,
                                                              pk_0,
                                                              use_counter_0,
                                                              sig_0,
                                                              envelope_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      withdraw_shielded_with_jubjub: async (...args_1) => {
        if (args_1.length !== 9) {
          throw new __compactRuntime.CompactError(`withdraw_shielded_with_jubjub: expected 9 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const recipient_0 = args_1[1];
        const color_0 = args_1[2];
        const amount_0 = args_1[3];
        const pk_0 = args_1[4];
        const use_counter_0 = args_1[5];
        const sig_r_0 = args_1[6];
        const sig_s_0 = args_1[7];
        const grind_nonce_0 = args_1[8];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('withdraw_shielded_with_jubjub',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 1055 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_with_jubjub',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 1055 char 1',
                                     'struct ZswapCoinPublicKey<bytes: Bytes<32>>',
                                     recipient_0)
        }
        if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_with_jubjub',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 1055 char 1',
                                     'Bytes<32>',
                                     color_0)
        }
        if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_shielded_with_jubjub',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 1055 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     amount_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
          __compactRuntime.typeError('withdraw_shielded_with_jubjub',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 1055 char 1',
                                     'JubjubPoint',
                                     pk_0)
        }
        if (!(typeof(use_counter_0) === 'bigint' && use_counter_0 >= 0n && use_counter_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('withdraw_shielded_with_jubjub',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 1055 char 1',
                                     'Uint<0..18446744073709551616>',
                                     use_counter_0)
        }
        if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
          __compactRuntime.typeError('withdraw_shielded_with_jubjub',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'account.compact line 1055 char 1',
                                     'JubjubPoint',
                                     sig_r_0)
        }
        if (!(typeof(sig_s_0) === 'bigint' && sig_s_0 >= 0 && sig_s_0 <= __compactRuntime.MAX_FIELD)) {
          __compactRuntime.typeError('withdraw_shielded_with_jubjub',
                                     'argument 7 (argument 8 as invoked from Typescript)',
                                     'account.compact line 1055 char 1',
                                     'Field',
                                     sig_s_0)
        }
        if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('withdraw_shielded_with_jubjub',
                                     'argument 8 (argument 9 as invoked from Typescript)',
                                     'account.compact line 1055 char 1',
                                     'Uint<0..18446744073709551616>',
                                     grind_nonce_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_19.toValue(recipient_0).concat(_descriptor_1.toValue(color_0).concat(_descriptor_10.toValue(amount_0).concat(_descriptor_3.toValue(pk_0).concat(_descriptor_0.toValue(use_counter_0).concat(_descriptor_3.toValue(sig_r_0).concat(_descriptor_4.toValue(sig_s_0).concat(_descriptor_0.toValue(grind_nonce_0)))))))),
            alignment: _descriptor_19.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_3.alignment().concat(_descriptor_0.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment().concat(_descriptor_0.alignment())))))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._withdraw_shielded_with_jubjub_0(context,
                                                                     partialProofData,
                                                                     recipient_0,
                                                                     color_0,
                                                                     amount_0,
                                                                     pk_0,
                                                                     use_counter_0,
                                                                     sig_r_0,
                                                                     sig_s_0,
                                                                     grind_nonce_0);
        partialProofData.output = { value: _descriptor_16.toValue(result_0), alignment: _descriptor_16.alignment() };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      withdraw_shielded_with_k256: async (...args_1) => {
        if (args_1.length !== 8) {
          throw new __compactRuntime.CompactError(`withdraw_shielded_with_k256: expected 8 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const recipient_0 = args_1[1];
        const color_0 = args_1[2];
        const amount_0 = args_1[3];
        const pk_0 = args_1[4];
        const use_counter_0 = args_1[5];
        const sig_0 = args_1[6];
        const envelope_0 = args_1[7];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('withdraw_shielded_with_k256',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 1073 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_with_k256',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 1073 char 1',
                                     'struct ZswapCoinPublicKey<bytes: Bytes<32>>',
                                     recipient_0)
        }
        if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_with_k256',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 1073 char 1',
                                     'Bytes<32>',
                                     color_0)
        }
        if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_shielded_with_k256',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 1073 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     amount_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
          __compactRuntime.typeError('withdraw_shielded_with_k256',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 1073 char 1',
                                     'Secp256k1Point',
                                     pk_0)
        }
        if (!(typeof(use_counter_0) === 'bigint' && use_counter_0 >= 0n && use_counter_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('withdraw_shielded_with_k256',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 1073 char 1',
                                     'Uint<0..18446744073709551616>',
                                     use_counter_0)
        }
        if (!(typeof(sig_0) === 'object' && typeof(sig_0.r) === 'bigint' && sig_0.r >= 0 && sig_0.r <= __compactRuntime.MAX_SECP256K1_SCALAR && typeof(sig_0.s) === 'bigint' && sig_0.s >= 0 && sig_0.s <= __compactRuntime.MAX_SECP256K1_SCALAR)) {
          __compactRuntime.typeError('withdraw_shielded_with_k256',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'account.compact line 1073 char 1',
                                     'struct Secp256k1EcdsaSignature<r: Secp256k1Scalar, s: Secp256k1Scalar>',
                                     sig_0)
        }
        if (!(typeof(envelope_0) === 'bigint' && envelope_0 >= 0n && envelope_0 <= 255n)) {
          __compactRuntime.typeError('withdraw_shielded_with_k256',
                                     'argument 7 (argument 8 as invoked from Typescript)',
                                     'account.compact line 1073 char 1',
                                     'Uint<0..256>',
                                     envelope_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_19.toValue(recipient_0).concat(_descriptor_1.toValue(color_0).concat(_descriptor_10.toValue(amount_0).concat(_descriptor_5.toValue(pk_0).concat(_descriptor_0.toValue(use_counter_0).concat(_descriptor_7.toValue(sig_0).concat(_descriptor_8.toValue(envelope_0))))))),
            alignment: _descriptor_19.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_5.alignment().concat(_descriptor_0.alignment().concat(_descriptor_7.alignment().concat(_descriptor_8.alignment()))))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._withdraw_shielded_with_k256_0(context,
                                                                   partialProofData,
                                                                   recipient_0,
                                                                   color_0,
                                                                   amount_0,
                                                                   pk_0,
                                                                   use_counter_0,
                                                                   sig_0,
                                                                   envelope_0);
        partialProofData.output = { value: _descriptor_16.toValue(result_0), alignment: _descriptor_16.alignment() };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      withdraw_shielded_to_contract_with_jubjub: async (...args_1) => {
        if (args_1.length !== 9) {
          throw new __compactRuntime.CompactError(`withdraw_shielded_to_contract_with_jubjub: expected 9 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const recipient_0 = args_1[1];
        const color_0 = args_1[2];
        const amount_0 = args_1[3];
        const pk_0 = args_1[4];
        const use_counter_0 = args_1[5];
        const sig_r_0 = args_1[6];
        const sig_s_0 = args_1[7];
        const grind_nonce_0 = args_1[8];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_jubjub',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 1104 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_jubjub',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 1104 char 1',
                                     'struct ContractAddress<bytes: Bytes<32>>',
                                     recipient_0)
        }
        if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_jubjub',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 1104 char 1',
                                     'Bytes<32>',
                                     color_0)
        }
        if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_jubjub',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 1104 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     amount_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_jubjub',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 1104 char 1',
                                     'JubjubPoint',
                                     pk_0)
        }
        if (!(typeof(use_counter_0) === 'bigint' && use_counter_0 >= 0n && use_counter_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_jubjub',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 1104 char 1',
                                     'Uint<0..18446744073709551616>',
                                     use_counter_0)
        }
        if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_jubjub',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'account.compact line 1104 char 1',
                                     'JubjubPoint',
                                     sig_r_0)
        }
        if (!(typeof(sig_s_0) === 'bigint' && sig_s_0 >= 0 && sig_s_0 <= __compactRuntime.MAX_FIELD)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_jubjub',
                                     'argument 7 (argument 8 as invoked from Typescript)',
                                     'account.compact line 1104 char 1',
                                     'Field',
                                     sig_s_0)
        }
        if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_jubjub',
                                     'argument 8 (argument 9 as invoked from Typescript)',
                                     'account.compact line 1104 char 1',
                                     'Uint<0..18446744073709551616>',
                                     grind_nonce_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_2.toValue(recipient_0).concat(_descriptor_1.toValue(color_0).concat(_descriptor_10.toValue(amount_0).concat(_descriptor_3.toValue(pk_0).concat(_descriptor_0.toValue(use_counter_0).concat(_descriptor_3.toValue(sig_r_0).concat(_descriptor_4.toValue(sig_s_0).concat(_descriptor_0.toValue(grind_nonce_0)))))))),
            alignment: _descriptor_2.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_3.alignment().concat(_descriptor_0.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment().concat(_descriptor_0.alignment())))))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._withdraw_shielded_to_contract_with_jubjub_0(context,
                                                                                 partialProofData,
                                                                                 recipient_0,
                                                                                 color_0,
                                                                                 amount_0,
                                                                                 pk_0,
                                                                                 use_counter_0,
                                                                                 sig_r_0,
                                                                                 sig_s_0,
                                                                                 grind_nonce_0);
        partialProofData.output = { value: _descriptor_17.toValue(result_0), alignment: _descriptor_17.alignment() };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      withdraw_shielded_to_contract_with_k256: async (...args_1) => {
        if (args_1.length !== 8) {
          throw new __compactRuntime.CompactError(`withdraw_shielded_to_contract_with_k256: expected 8 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const recipient_0 = args_1[1];
        const color_0 = args_1[2];
        const amount_0 = args_1[3];
        const pk_0 = args_1[4];
        const use_counter_0 = args_1[5];
        const sig_0 = args_1[6];
        const envelope_0 = args_1[7];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_k256',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 1122 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_k256',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 1122 char 1',
                                     'struct ContractAddress<bytes: Bytes<32>>',
                                     recipient_0)
        }
        if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_k256',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 1122 char 1',
                                     'Bytes<32>',
                                     color_0)
        }
        if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_k256',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 1122 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     amount_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_k256',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 1122 char 1',
                                     'Secp256k1Point',
                                     pk_0)
        }
        if (!(typeof(use_counter_0) === 'bigint' && use_counter_0 >= 0n && use_counter_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_k256',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 1122 char 1',
                                     'Uint<0..18446744073709551616>',
                                     use_counter_0)
        }
        if (!(typeof(sig_0) === 'object' && typeof(sig_0.r) === 'bigint' && sig_0.r >= 0 && sig_0.r <= __compactRuntime.MAX_SECP256K1_SCALAR && typeof(sig_0.s) === 'bigint' && sig_0.s >= 0 && sig_0.s <= __compactRuntime.MAX_SECP256K1_SCALAR)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_k256',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'account.compact line 1122 char 1',
                                     'struct Secp256k1EcdsaSignature<r: Secp256k1Scalar, s: Secp256k1Scalar>',
                                     sig_0)
        }
        if (!(typeof(envelope_0) === 'bigint' && envelope_0 >= 0n && envelope_0 <= 255n)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_k256',
                                     'argument 7 (argument 8 as invoked from Typescript)',
                                     'account.compact line 1122 char 1',
                                     'Uint<0..256>',
                                     envelope_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_2.toValue(recipient_0).concat(_descriptor_1.toValue(color_0).concat(_descriptor_10.toValue(amount_0).concat(_descriptor_5.toValue(pk_0).concat(_descriptor_0.toValue(use_counter_0).concat(_descriptor_7.toValue(sig_0).concat(_descriptor_8.toValue(envelope_0))))))),
            alignment: _descriptor_2.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_5.alignment().concat(_descriptor_0.alignment().concat(_descriptor_7.alignment().concat(_descriptor_8.alignment()))))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._withdraw_shielded_to_contract_with_k256_0(context,
                                                                               partialProofData,
                                                                               recipient_0,
                                                                               color_0,
                                                                               amount_0,
                                                                               pk_0,
                                                                               use_counter_0,
                                                                               sig_0,
                                                                               envelope_0);
        partialProofData.output = { value: _descriptor_17.toValue(result_0), alignment: _descriptor_17.alignment() };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      rotate_enc_key_with_jubjub: async (...args_1) => {
        if (args_1.length !== 7) {
          throw new __compactRuntime.CompactError(`rotate_enc_key_with_jubjub: expected 7 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const new_key_0 = args_1[1];
        const pk_0 = args_1[2];
        const use_counter_0 = args_1[3];
        const sig_r_0 = args_1[4];
        const sig_s_0 = args_1[5];
        const grind_nonce_0 = args_1[6];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('rotate_enc_key_with_jubjub',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 1145 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(new_key_0.buffer instanceof ArrayBuffer && new_key_0.BYTES_PER_ELEMENT === 1 && new_key_0.length === 32)) {
          __compactRuntime.typeError('rotate_enc_key_with_jubjub',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 1145 char 1',
                                     'Bytes<32>',
                                     new_key_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
          __compactRuntime.typeError('rotate_enc_key_with_jubjub',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 1145 char 1',
                                     'JubjubPoint',
                                     pk_0)
        }
        if (!(typeof(use_counter_0) === 'bigint' && use_counter_0 >= 0n && use_counter_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('rotate_enc_key_with_jubjub',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 1145 char 1',
                                     'Uint<0..18446744073709551616>',
                                     use_counter_0)
        }
        if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
          __compactRuntime.typeError('rotate_enc_key_with_jubjub',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 1145 char 1',
                                     'JubjubPoint',
                                     sig_r_0)
        }
        if (!(typeof(sig_s_0) === 'bigint' && sig_s_0 >= 0 && sig_s_0 <= __compactRuntime.MAX_FIELD)) {
          __compactRuntime.typeError('rotate_enc_key_with_jubjub',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 1145 char 1',
                                     'Field',
                                     sig_s_0)
        }
        if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('rotate_enc_key_with_jubjub',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'account.compact line 1145 char 1',
                                     'Uint<0..18446744073709551616>',
                                     grind_nonce_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_1.toValue(new_key_0).concat(_descriptor_3.toValue(pk_0).concat(_descriptor_0.toValue(use_counter_0).concat(_descriptor_3.toValue(sig_r_0).concat(_descriptor_4.toValue(sig_s_0).concat(_descriptor_0.toValue(grind_nonce_0)))))),
            alignment: _descriptor_1.alignment().concat(_descriptor_3.alignment().concat(_descriptor_0.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment().concat(_descriptor_0.alignment())))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._rotate_enc_key_with_jubjub_0(context,
                                                                  partialProofData,
                                                                  new_key_0,
                                                                  pk_0,
                                                                  use_counter_0,
                                                                  sig_r_0,
                                                                  sig_s_0,
                                                                  grind_nonce_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      rotate_enc_key_with_k256: async (...args_1) => {
        if (args_1.length !== 6) {
          throw new __compactRuntime.CompactError(`rotate_enc_key_with_k256: expected 6 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const new_key_0 = args_1[1];
        const pk_0 = args_1[2];
        const use_counter_0 = args_1[3];
        const sig_0 = args_1[4];
        const envelope_0 = args_1[5];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('rotate_enc_key_with_k256',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 1160 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(new_key_0.buffer instanceof ArrayBuffer && new_key_0.BYTES_PER_ELEMENT === 1 && new_key_0.length === 32)) {
          __compactRuntime.typeError('rotate_enc_key_with_k256',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 1160 char 1',
                                     'Bytes<32>',
                                     new_key_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
          __compactRuntime.typeError('rotate_enc_key_with_k256',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 1160 char 1',
                                     'Secp256k1Point',
                                     pk_0)
        }
        if (!(typeof(use_counter_0) === 'bigint' && use_counter_0 >= 0n && use_counter_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('rotate_enc_key_with_k256',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 1160 char 1',
                                     'Uint<0..18446744073709551616>',
                                     use_counter_0)
        }
        if (!(typeof(sig_0) === 'object' && typeof(sig_0.r) === 'bigint' && sig_0.r >= 0 && sig_0.r <= __compactRuntime.MAX_SECP256K1_SCALAR && typeof(sig_0.s) === 'bigint' && sig_0.s >= 0 && sig_0.s <= __compactRuntime.MAX_SECP256K1_SCALAR)) {
          __compactRuntime.typeError('rotate_enc_key_with_k256',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 1160 char 1',
                                     'struct Secp256k1EcdsaSignature<r: Secp256k1Scalar, s: Secp256k1Scalar>',
                                     sig_0)
        }
        if (!(typeof(envelope_0) === 'bigint' && envelope_0 >= 0n && envelope_0 <= 255n)) {
          __compactRuntime.typeError('rotate_enc_key_with_k256',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 1160 char 1',
                                     'Uint<0..256>',
                                     envelope_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_1.toValue(new_key_0).concat(_descriptor_5.toValue(pk_0).concat(_descriptor_0.toValue(use_counter_0).concat(_descriptor_7.toValue(sig_0).concat(_descriptor_8.toValue(envelope_0))))),
            alignment: _descriptor_1.alignment().concat(_descriptor_5.alignment().concat(_descriptor_0.alignment().concat(_descriptor_7.alignment().concat(_descriptor_8.alignment()))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._rotate_enc_key_with_k256_0(context,
                                                                partialProofData,
                                                                new_key_0,
                                                                pk_0,
                                                                use_counter_0,
                                                                sig_0,
                                                                envelope_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      add_device_with_jubjub: async (...args_1) => {
        if (args_1.length !== 7) {
          throw new __compactRuntime.CompactError(`add_device_with_jubjub: expected 7 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const new_entry_0 = args_1[1];
        const pk_0 = args_1[2];
        const use_counter_0 = args_1[3];
        const sig_r_0 = args_1[4];
        const sig_s_0 = args_1[5];
        const grind_nonce_0 = args_1[6];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('add_device_with_jubjub',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 1240 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(new_entry_0.buffer instanceof ArrayBuffer && new_entry_0.BYTES_PER_ELEMENT === 1 && new_entry_0.length === 32)) {
          __compactRuntime.typeError('add_device_with_jubjub',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 1240 char 1',
                                     'Bytes<32>',
                                     new_entry_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
          __compactRuntime.typeError('add_device_with_jubjub',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 1240 char 1',
                                     'JubjubPoint',
                                     pk_0)
        }
        if (!(typeof(use_counter_0) === 'bigint' && use_counter_0 >= 0n && use_counter_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('add_device_with_jubjub',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 1240 char 1',
                                     'Uint<0..18446744073709551616>',
                                     use_counter_0)
        }
        if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
          __compactRuntime.typeError('add_device_with_jubjub',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 1240 char 1',
                                     'JubjubPoint',
                                     sig_r_0)
        }
        if (!(typeof(sig_s_0) === 'bigint' && sig_s_0 >= 0 && sig_s_0 <= __compactRuntime.MAX_FIELD)) {
          __compactRuntime.typeError('add_device_with_jubjub',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 1240 char 1',
                                     'Field',
                                     sig_s_0)
        }
        if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('add_device_with_jubjub',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'account.compact line 1240 char 1',
                                     'Uint<0..18446744073709551616>',
                                     grind_nonce_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_1.toValue(new_entry_0).concat(_descriptor_3.toValue(pk_0).concat(_descriptor_0.toValue(use_counter_0).concat(_descriptor_3.toValue(sig_r_0).concat(_descriptor_4.toValue(sig_s_0).concat(_descriptor_0.toValue(grind_nonce_0)))))),
            alignment: _descriptor_1.alignment().concat(_descriptor_3.alignment().concat(_descriptor_0.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment().concat(_descriptor_0.alignment())))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._add_device_with_jubjub_0(context,
                                                              partialProofData,
                                                              new_entry_0,
                                                              pk_0,
                                                              use_counter_0,
                                                              sig_r_0,
                                                              sig_s_0,
                                                              grind_nonce_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      add_device_with_k256: async (...args_1) => {
        if (args_1.length !== 6) {
          throw new __compactRuntime.CompactError(`add_device_with_k256: expected 6 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const new_entry_0 = args_1[1];
        const pk_0 = args_1[2];
        const use_counter_0 = args_1[3];
        const sig_0 = args_1[4];
        const envelope_0 = args_1[5];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('add_device_with_k256',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 1255 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(new_entry_0.buffer instanceof ArrayBuffer && new_entry_0.BYTES_PER_ELEMENT === 1 && new_entry_0.length === 32)) {
          __compactRuntime.typeError('add_device_with_k256',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 1255 char 1',
                                     'Bytes<32>',
                                     new_entry_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
          __compactRuntime.typeError('add_device_with_k256',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 1255 char 1',
                                     'Secp256k1Point',
                                     pk_0)
        }
        if (!(typeof(use_counter_0) === 'bigint' && use_counter_0 >= 0n && use_counter_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('add_device_with_k256',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 1255 char 1',
                                     'Uint<0..18446744073709551616>',
                                     use_counter_0)
        }
        if (!(typeof(sig_0) === 'object' && typeof(sig_0.r) === 'bigint' && sig_0.r >= 0 && sig_0.r <= __compactRuntime.MAX_SECP256K1_SCALAR && typeof(sig_0.s) === 'bigint' && sig_0.s >= 0 && sig_0.s <= __compactRuntime.MAX_SECP256K1_SCALAR)) {
          __compactRuntime.typeError('add_device_with_k256',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 1255 char 1',
                                     'struct Secp256k1EcdsaSignature<r: Secp256k1Scalar, s: Secp256k1Scalar>',
                                     sig_0)
        }
        if (!(typeof(envelope_0) === 'bigint' && envelope_0 >= 0n && envelope_0 <= 255n)) {
          __compactRuntime.typeError('add_device_with_k256',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 1255 char 1',
                                     'Uint<0..256>',
                                     envelope_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_1.toValue(new_entry_0).concat(_descriptor_5.toValue(pk_0).concat(_descriptor_0.toValue(use_counter_0).concat(_descriptor_7.toValue(sig_0).concat(_descriptor_8.toValue(envelope_0))))),
            alignment: _descriptor_1.alignment().concat(_descriptor_5.alignment().concat(_descriptor_0.alignment().concat(_descriptor_7.alignment().concat(_descriptor_8.alignment()))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._add_device_with_k256_0(context,
                                                            partialProofData,
                                                            new_entry_0,
                                                            pk_0,
                                                            use_counter_0,
                                                            sig_0,
                                                            envelope_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      remove_device_with_jubjub: async (...args_1) => {
        if (args_1.length !== 7) {
          throw new __compactRuntime.CompactError(`remove_device_with_jubjub: expected 7 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const entry_0 = args_1[1];
        const pk_0 = args_1[2];
        const use_counter_0 = args_1[3];
        const sig_r_0 = args_1[4];
        const sig_s_0 = args_1[5];
        const grind_nonce_0 = args_1[6];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('remove_device_with_jubjub',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 1275 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(entry_0.buffer instanceof ArrayBuffer && entry_0.BYTES_PER_ELEMENT === 1 && entry_0.length === 32)) {
          __compactRuntime.typeError('remove_device_with_jubjub',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 1275 char 1',
                                     'Bytes<32>',
                                     entry_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
          __compactRuntime.typeError('remove_device_with_jubjub',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 1275 char 1',
                                     'JubjubPoint',
                                     pk_0)
        }
        if (!(typeof(use_counter_0) === 'bigint' && use_counter_0 >= 0n && use_counter_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('remove_device_with_jubjub',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 1275 char 1',
                                     'Uint<0..18446744073709551616>',
                                     use_counter_0)
        }
        if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
          __compactRuntime.typeError('remove_device_with_jubjub',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 1275 char 1',
                                     'JubjubPoint',
                                     sig_r_0)
        }
        if (!(typeof(sig_s_0) === 'bigint' && sig_s_0 >= 0 && sig_s_0 <= __compactRuntime.MAX_FIELD)) {
          __compactRuntime.typeError('remove_device_with_jubjub',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 1275 char 1',
                                     'Field',
                                     sig_s_0)
        }
        if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('remove_device_with_jubjub',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'account.compact line 1275 char 1',
                                     'Uint<0..18446744073709551616>',
                                     grind_nonce_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_1.toValue(entry_0).concat(_descriptor_3.toValue(pk_0).concat(_descriptor_0.toValue(use_counter_0).concat(_descriptor_3.toValue(sig_r_0).concat(_descriptor_4.toValue(sig_s_0).concat(_descriptor_0.toValue(grind_nonce_0)))))),
            alignment: _descriptor_1.alignment().concat(_descriptor_3.alignment().concat(_descriptor_0.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment().concat(_descriptor_0.alignment())))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._remove_device_with_jubjub_0(context,
                                                                 partialProofData,
                                                                 entry_0,
                                                                 pk_0,
                                                                 use_counter_0,
                                                                 sig_r_0,
                                                                 sig_s_0,
                                                                 grind_nonce_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      remove_device_with_k256: async (...args_1) => {
        if (args_1.length !== 6) {
          throw new __compactRuntime.CompactError(`remove_device_with_k256: expected 6 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const entry_0 = args_1[1];
        const pk_0 = args_1[2];
        const use_counter_0 = args_1[3];
        const sig_0 = args_1[4];
        const envelope_0 = args_1[5];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('remove_device_with_k256',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 1294 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(entry_0.buffer instanceof ArrayBuffer && entry_0.BYTES_PER_ELEMENT === 1 && entry_0.length === 32)) {
          __compactRuntime.typeError('remove_device_with_k256',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 1294 char 1',
                                     'Bytes<32>',
                                     entry_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
          __compactRuntime.typeError('remove_device_with_k256',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 1294 char 1',
                                     'Secp256k1Point',
                                     pk_0)
        }
        if (!(typeof(use_counter_0) === 'bigint' && use_counter_0 >= 0n && use_counter_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('remove_device_with_k256',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 1294 char 1',
                                     'Uint<0..18446744073709551616>',
                                     use_counter_0)
        }
        if (!(typeof(sig_0) === 'object' && typeof(sig_0.r) === 'bigint' && sig_0.r >= 0 && sig_0.r <= __compactRuntime.MAX_SECP256K1_SCALAR && typeof(sig_0.s) === 'bigint' && sig_0.s >= 0 && sig_0.s <= __compactRuntime.MAX_SECP256K1_SCALAR)) {
          __compactRuntime.typeError('remove_device_with_k256',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 1294 char 1',
                                     'struct Secp256k1EcdsaSignature<r: Secp256k1Scalar, s: Secp256k1Scalar>',
                                     sig_0)
        }
        if (!(typeof(envelope_0) === 'bigint' && envelope_0 >= 0n && envelope_0 <= 255n)) {
          __compactRuntime.typeError('remove_device_with_k256',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 1294 char 1',
                                     'Uint<0..256>',
                                     envelope_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_1.toValue(entry_0).concat(_descriptor_5.toValue(pk_0).concat(_descriptor_0.toValue(use_counter_0).concat(_descriptor_7.toValue(sig_0).concat(_descriptor_8.toValue(envelope_0))))),
            alignment: _descriptor_1.alignment().concat(_descriptor_5.alignment().concat(_descriptor_0.alignment().concat(_descriptor_7.alignment().concat(_descriptor_8.alignment()))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._remove_device_with_k256_0(context,
                                                               partialProofData,
                                                               entry_0,
                                                               pk_0,
                                                               use_counter_0,
                                                               sig_0,
                                                               envelope_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      async derive_grant_id_with_k256(context, ...args_1) {
        return { result: pureCircuits.derive_grant_id_with_k256(...args_1), context };
      },
      async derive_grant_id_with_jubjub(context, ...args_1) {
        return { result: pureCircuits.derive_grant_id_with_jubjub(...args_1), context };
      },
      async derive_grant_object_commit(context, ...args_1) {
        return { result: pureCircuits.derive_grant_object_commit(...args_1), context };
      },
      async derive_grant_spent_commit(context, ...args_1) {
        return { result: pureCircuits.derive_grant_spent_commit(...args_1), context };
      },
      async derive_grant_rp_commit(context, ...args_1) {
        return { result: pureCircuits.derive_grant_rp_commit(...args_1), context };
      },
      async derive_grant_scope_digest(context, ...args_1) {
        return { result: pureCircuits.derive_grant_scope_digest(...args_1), context };
      },
      async challenge_withdraw_unshielded_with_grant_k256(context, ...args_1) {
        return { result: pureCircuits.challenge_withdraw_unshielded_with_grant_k256(...args_1), context };
      },
      async challenge_withdraw_shielded_with_grant_k256(context, ...args_1) {
        return { result: pureCircuits.challenge_withdraw_shielded_with_grant_k256(...args_1), context };
      },
      async challenge_withdraw_shielded_to_contract_with_grant_k256(context, ...args_1) {
        return { result: pureCircuits.challenge_withdraw_shielded_to_contract_with_grant_k256(...args_1), context };
      },
      async challenge_withdraw_unshielded_with_grant_jubjub(context, ...args_1) {
        return { result: pureCircuits.challenge_withdraw_unshielded_with_grant_jubjub(...args_1), context };
      },
      async challenge_withdraw_shielded_with_grant_jubjub(context, ...args_1) {
        return { result: pureCircuits.challenge_withdraw_shielded_with_grant_jubjub(...args_1), context };
      },
      async challenge_withdraw_shielded_to_contract_with_grant_jubjub(context, ...args_1) {
        return { result: pureCircuits.challenge_withdraw_shielded_to_contract_with_grant_jubjub(...args_1), context };
      },
      async challenge_issue_grant_with_k256(context, ...args_1) {
        return { result: pureCircuits.challenge_issue_grant_with_k256(...args_1), context };
      },
      async challenge_revoke_grant_with_k256(context, ...args_1) {
        return { result: pureCircuits.challenge_revoke_grant_with_k256(...args_1), context };
      },
      async challenge_revoke_all_grants_with_k256(context, ...args_1) {
        return { result: pureCircuits.challenge_revoke_all_grants_with_k256(...args_1), context };
      },
      async challenge_issue_grant_with_jubjub(context, ...args_1) {
        return { result: pureCircuits.challenge_issue_grant_with_jubjub(...args_1), context };
      },
      async challenge_revoke_grant_with_jubjub(context, ...args_1) {
        return { result: pureCircuits.challenge_revoke_grant_with_jubjub(...args_1), context };
      },
      async challenge_revoke_all_grants_with_jubjub(context, ...args_1) {
        return { result: pureCircuits.challenge_revoke_all_grants_with_jubjub(...args_1), context };
      },
      withdraw_unshielded_with_grant_k256: async (...args_1) => {
        if (args_1.length !== 14) {
          throw new __compactRuntime.CompactError(`withdraw_unshielded_with_grant_k256: expected 14 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const color_0 = args_1[1];
        const amount_0 = args_1[2];
        const recipient_0 = args_1[3];
        const pk_0 = args_1[4];
        const envelope_0 = args_1[5];
        const origin_hash_0 = args_1[6];
        const slot_0 = args_1[7];
        const scope_salt_0 = args_1[8];
        const recipient_kind_0 = args_1[9];
        const pinned_recipient_0 = args_1[10];
        const max_coin_value_0 = args_1[11];
        const spent_prev_0 = args_1[12];
        const sig_0 = args_1[13];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_k256',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 1932 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_k256',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 1932 char 1',
                                     'Bytes<32>',
                                     color_0)
        }
        if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_k256',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 1932 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     amount_0)
        }
        if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_k256',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 1932 char 1',
                                     'struct UserAddress<bytes: Bytes<32>>',
                                     recipient_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_k256',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 1932 char 1',
                                     'Secp256k1Point',
                                     pk_0)
        }
        if (!(typeof(envelope_0) === 'bigint' && envelope_0 >= 0n && envelope_0 <= 255n)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_k256',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 1932 char 1',
                                     'Uint<0..256>',
                                     envelope_0)
        }
        if (!(origin_hash_0.buffer instanceof ArrayBuffer && origin_hash_0.BYTES_PER_ELEMENT === 1 && origin_hash_0.length === 32)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_k256',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'account.compact line 1932 char 1',
                                     'Bytes<32>',
                                     origin_hash_0)
        }
        if (!(typeof(slot_0) === 'bigint' && slot_0 >= 0n && slot_0 <= 255n)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_k256',
                                     'argument 7 (argument 8 as invoked from Typescript)',
                                     'account.compact line 1932 char 1',
                                     'Uint<0..256>',
                                     slot_0)
        }
        if (!(scope_salt_0.buffer instanceof ArrayBuffer && scope_salt_0.BYTES_PER_ELEMENT === 1 && scope_salt_0.length === 32)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_k256',
                                     'argument 8 (argument 9 as invoked from Typescript)',
                                     'account.compact line 1932 char 1',
                                     'Bytes<32>',
                                     scope_salt_0)
        }
        if (!(typeof(recipient_kind_0) === 'bigint' && recipient_kind_0 >= 0n && recipient_kind_0 <= 255n)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_k256',
                                     'argument 9 (argument 10 as invoked from Typescript)',
                                     'account.compact line 1932 char 1',
                                     'Uint<0..256>',
                                     recipient_kind_0)
        }
        if (!(pinned_recipient_0.buffer instanceof ArrayBuffer && pinned_recipient_0.BYTES_PER_ELEMENT === 1 && pinned_recipient_0.length === 32)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_k256',
                                     'argument 10 (argument 11 as invoked from Typescript)',
                                     'account.compact line 1932 char 1',
                                     'Bytes<32>',
                                     pinned_recipient_0)
        }
        if (!(typeof(max_coin_value_0) === 'bigint' && max_coin_value_0 >= 0n && max_coin_value_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_k256',
                                     'argument 11 (argument 12 as invoked from Typescript)',
                                     'account.compact line 1932 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     max_coin_value_0)
        }
        if (!(typeof(spent_prev_0) === 'bigint' && spent_prev_0 >= 0n && spent_prev_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_k256',
                                     'argument 12 (argument 13 as invoked from Typescript)',
                                     'account.compact line 1932 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     spent_prev_0)
        }
        if (!(typeof(sig_0) === 'object' && typeof(sig_0.r) === 'bigint' && sig_0.r >= 0 && sig_0.r <= __compactRuntime.MAX_SECP256K1_SCALAR && typeof(sig_0.s) === 'bigint' && sig_0.s >= 0 && sig_0.s <= __compactRuntime.MAX_SECP256K1_SCALAR)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_k256',
                                     'argument 13 (argument 14 as invoked from Typescript)',
                                     'account.compact line 1932 char 1',
                                     'struct Secp256k1EcdsaSignature<r: Secp256k1Scalar, s: Secp256k1Scalar>',
                                     sig_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_1.toValue(color_0).concat(_descriptor_10.toValue(amount_0).concat(_descriptor_18.toValue(recipient_0).concat(_descriptor_5.toValue(pk_0).concat(_descriptor_8.toValue(envelope_0).concat(_descriptor_1.toValue(origin_hash_0).concat(_descriptor_8.toValue(slot_0).concat(_descriptor_1.toValue(scope_salt_0).concat(_descriptor_8.toValue(recipient_kind_0).concat(_descriptor_1.toValue(pinned_recipient_0).concat(_descriptor_10.toValue(max_coin_value_0).concat(_descriptor_10.toValue(spent_prev_0).concat(_descriptor_7.toValue(sig_0))))))))))))),
            alignment: _descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_18.alignment().concat(_descriptor_5.alignment().concat(_descriptor_8.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_10.alignment().concat(_descriptor_7.alignment()))))))))))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._withdraw_unshielded_with_grant_k256_0(context,
                                                                           partialProofData,
                                                                           color_0,
                                                                           amount_0,
                                                                           recipient_0,
                                                                           pk_0,
                                                                           envelope_0,
                                                                           origin_hash_0,
                                                                           slot_0,
                                                                           scope_salt_0,
                                                                           recipient_kind_0,
                                                                           pinned_recipient_0,
                                                                           max_coin_value_0,
                                                                           spent_prev_0,
                                                                           sig_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      withdraw_shielded_with_grant_k256: async (...args_1) => {
        if (args_1.length !== 16) {
          throw new __compactRuntime.CompactError(`withdraw_shielded_with_grant_k256: expected 16 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const recipient_0 = args_1[1];
        const color_0 = args_1[2];
        const amount_0 = args_1[3];
        const change_entry_0 = args_1[4];
        const enc_pk_0 = args_1[5];
        const pk_0 = args_1[6];
        const envelope_0 = args_1[7];
        const origin_hash_0 = args_1[8];
        const slot_0 = args_1[9];
        const scope_salt_0 = args_1[10];
        const recipient_kind_0 = args_1[11];
        const pinned_recipient_0 = args_1[12];
        const max_coin_value_0 = args_1[13];
        const spent_prev_0 = args_1[14];
        const sig_0 = args_1[15];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_k256',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 1965 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_k256',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 1965 char 1',
                                     'struct ZswapCoinPublicKey<bytes: Bytes<32>>',
                                     recipient_0)
        }
        if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_k256',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 1965 char 1',
                                     'Bytes<32>',
                                     color_0)
        }
        if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_k256',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 1965 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     amount_0)
        }
        if (!(change_entry_0.buffer instanceof ArrayBuffer && change_entry_0.BYTES_PER_ELEMENT === 1 && change_entry_0.length === 192)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_k256',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 1965 char 1',
                                     'Bytes<192>',
                                     change_entry_0)
        }
        if (!(enc_pk_0.buffer instanceof ArrayBuffer && enc_pk_0.BYTES_PER_ELEMENT === 1 && enc_pk_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_k256',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 1965 char 1',
                                     'Bytes<32>',
                                     enc_pk_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_k256',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'account.compact line 1965 char 1',
                                     'Secp256k1Point',
                                     pk_0)
        }
        if (!(typeof(envelope_0) === 'bigint' && envelope_0 >= 0n && envelope_0 <= 255n)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_k256',
                                     'argument 7 (argument 8 as invoked from Typescript)',
                                     'account.compact line 1965 char 1',
                                     'Uint<0..256>',
                                     envelope_0)
        }
        if (!(origin_hash_0.buffer instanceof ArrayBuffer && origin_hash_0.BYTES_PER_ELEMENT === 1 && origin_hash_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_k256',
                                     'argument 8 (argument 9 as invoked from Typescript)',
                                     'account.compact line 1965 char 1',
                                     'Bytes<32>',
                                     origin_hash_0)
        }
        if (!(typeof(slot_0) === 'bigint' && slot_0 >= 0n && slot_0 <= 255n)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_k256',
                                     'argument 9 (argument 10 as invoked from Typescript)',
                                     'account.compact line 1965 char 1',
                                     'Uint<0..256>',
                                     slot_0)
        }
        if (!(scope_salt_0.buffer instanceof ArrayBuffer && scope_salt_0.BYTES_PER_ELEMENT === 1 && scope_salt_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_k256',
                                     'argument 10 (argument 11 as invoked from Typescript)',
                                     'account.compact line 1965 char 1',
                                     'Bytes<32>',
                                     scope_salt_0)
        }
        if (!(typeof(recipient_kind_0) === 'bigint' && recipient_kind_0 >= 0n && recipient_kind_0 <= 255n)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_k256',
                                     'argument 11 (argument 12 as invoked from Typescript)',
                                     'account.compact line 1965 char 1',
                                     'Uint<0..256>',
                                     recipient_kind_0)
        }
        if (!(pinned_recipient_0.buffer instanceof ArrayBuffer && pinned_recipient_0.BYTES_PER_ELEMENT === 1 && pinned_recipient_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_k256',
                                     'argument 12 (argument 13 as invoked from Typescript)',
                                     'account.compact line 1965 char 1',
                                     'Bytes<32>',
                                     pinned_recipient_0)
        }
        if (!(typeof(max_coin_value_0) === 'bigint' && max_coin_value_0 >= 0n && max_coin_value_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_k256',
                                     'argument 13 (argument 14 as invoked from Typescript)',
                                     'account.compact line 1965 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     max_coin_value_0)
        }
        if (!(typeof(spent_prev_0) === 'bigint' && spent_prev_0 >= 0n && spent_prev_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_k256',
                                     'argument 14 (argument 15 as invoked from Typescript)',
                                     'account.compact line 1965 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     spent_prev_0)
        }
        if (!(typeof(sig_0) === 'object' && typeof(sig_0.r) === 'bigint' && sig_0.r >= 0 && sig_0.r <= __compactRuntime.MAX_SECP256K1_SCALAR && typeof(sig_0.s) === 'bigint' && sig_0.s >= 0 && sig_0.s <= __compactRuntime.MAX_SECP256K1_SCALAR)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_k256',
                                     'argument 15 (argument 16 as invoked from Typescript)',
                                     'account.compact line 1965 char 1',
                                     'struct Secp256k1EcdsaSignature<r: Secp256k1Scalar, s: Secp256k1Scalar>',
                                     sig_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_19.toValue(recipient_0).concat(_descriptor_1.toValue(color_0).concat(_descriptor_10.toValue(amount_0).concat(_descriptor_14.toValue(change_entry_0).concat(_descriptor_1.toValue(enc_pk_0).concat(_descriptor_5.toValue(pk_0).concat(_descriptor_8.toValue(envelope_0).concat(_descriptor_1.toValue(origin_hash_0).concat(_descriptor_8.toValue(slot_0).concat(_descriptor_1.toValue(scope_salt_0).concat(_descriptor_8.toValue(recipient_kind_0).concat(_descriptor_1.toValue(pinned_recipient_0).concat(_descriptor_10.toValue(max_coin_value_0).concat(_descriptor_10.toValue(spent_prev_0).concat(_descriptor_7.toValue(sig_0))))))))))))))),
            alignment: _descriptor_19.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_14.alignment().concat(_descriptor_1.alignment().concat(_descriptor_5.alignment().concat(_descriptor_8.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_10.alignment().concat(_descriptor_7.alignment()))))))))))))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._withdraw_shielded_with_grant_k256_0(context,
                                                                         partialProofData,
                                                                         recipient_0,
                                                                         color_0,
                                                                         amount_0,
                                                                         change_entry_0,
                                                                         enc_pk_0,
                                                                         pk_0,
                                                                         envelope_0,
                                                                         origin_hash_0,
                                                                         slot_0,
                                                                         scope_salt_0,
                                                                         recipient_kind_0,
                                                                         pinned_recipient_0,
                                                                         max_coin_value_0,
                                                                         spent_prev_0,
                                                                         sig_0);
        partialProofData.output = { value: _descriptor_16.toValue(result_0), alignment: _descriptor_16.alignment() };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      withdraw_shielded_to_contract_with_grant_k256: async (...args_1) => {
        if (args_1.length !== 16) {
          throw new __compactRuntime.CompactError(`withdraw_shielded_to_contract_with_grant_k256: expected 16 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const recipient_0 = args_1[1];
        const color_0 = args_1[2];
        const amount_0 = args_1[3];
        const change_entry_0 = args_1[4];
        const enc_pk_0 = args_1[5];
        const pk_0 = args_1[6];
        const envelope_0 = args_1[7];
        const origin_hash_0 = args_1[8];
        const slot_0 = args_1[9];
        const scope_salt_0 = args_1[10];
        const recipient_kind_0 = args_1[11];
        const pinned_recipient_0 = args_1[12];
        const max_coin_value_0 = args_1[13];
        const spent_prev_0 = args_1[14];
        const sig_0 = args_1[15];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_k256',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 2007 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_k256',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 2007 char 1',
                                     'struct ContractAddress<bytes: Bytes<32>>',
                                     recipient_0)
        }
        if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_k256',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 2007 char 1',
                                     'Bytes<32>',
                                     color_0)
        }
        if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_k256',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 2007 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     amount_0)
        }
        if (!(change_entry_0.buffer instanceof ArrayBuffer && change_entry_0.BYTES_PER_ELEMENT === 1 && change_entry_0.length === 192)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_k256',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 2007 char 1',
                                     'Bytes<192>',
                                     change_entry_0)
        }
        if (!(enc_pk_0.buffer instanceof ArrayBuffer && enc_pk_0.BYTES_PER_ELEMENT === 1 && enc_pk_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_k256',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 2007 char 1',
                                     'Bytes<32>',
                                     enc_pk_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_k256',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'account.compact line 2007 char 1',
                                     'Secp256k1Point',
                                     pk_0)
        }
        if (!(typeof(envelope_0) === 'bigint' && envelope_0 >= 0n && envelope_0 <= 255n)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_k256',
                                     'argument 7 (argument 8 as invoked from Typescript)',
                                     'account.compact line 2007 char 1',
                                     'Uint<0..256>',
                                     envelope_0)
        }
        if (!(origin_hash_0.buffer instanceof ArrayBuffer && origin_hash_0.BYTES_PER_ELEMENT === 1 && origin_hash_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_k256',
                                     'argument 8 (argument 9 as invoked from Typescript)',
                                     'account.compact line 2007 char 1',
                                     'Bytes<32>',
                                     origin_hash_0)
        }
        if (!(typeof(slot_0) === 'bigint' && slot_0 >= 0n && slot_0 <= 255n)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_k256',
                                     'argument 9 (argument 10 as invoked from Typescript)',
                                     'account.compact line 2007 char 1',
                                     'Uint<0..256>',
                                     slot_0)
        }
        if (!(scope_salt_0.buffer instanceof ArrayBuffer && scope_salt_0.BYTES_PER_ELEMENT === 1 && scope_salt_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_k256',
                                     'argument 10 (argument 11 as invoked from Typescript)',
                                     'account.compact line 2007 char 1',
                                     'Bytes<32>',
                                     scope_salt_0)
        }
        if (!(typeof(recipient_kind_0) === 'bigint' && recipient_kind_0 >= 0n && recipient_kind_0 <= 255n)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_k256',
                                     'argument 11 (argument 12 as invoked from Typescript)',
                                     'account.compact line 2007 char 1',
                                     'Uint<0..256>',
                                     recipient_kind_0)
        }
        if (!(pinned_recipient_0.buffer instanceof ArrayBuffer && pinned_recipient_0.BYTES_PER_ELEMENT === 1 && pinned_recipient_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_k256',
                                     'argument 12 (argument 13 as invoked from Typescript)',
                                     'account.compact line 2007 char 1',
                                     'Bytes<32>',
                                     pinned_recipient_0)
        }
        if (!(typeof(max_coin_value_0) === 'bigint' && max_coin_value_0 >= 0n && max_coin_value_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_k256',
                                     'argument 13 (argument 14 as invoked from Typescript)',
                                     'account.compact line 2007 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     max_coin_value_0)
        }
        if (!(typeof(spent_prev_0) === 'bigint' && spent_prev_0 >= 0n && spent_prev_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_k256',
                                     'argument 14 (argument 15 as invoked from Typescript)',
                                     'account.compact line 2007 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     spent_prev_0)
        }
        if (!(typeof(sig_0) === 'object' && typeof(sig_0.r) === 'bigint' && sig_0.r >= 0 && sig_0.r <= __compactRuntime.MAX_SECP256K1_SCALAR && typeof(sig_0.s) === 'bigint' && sig_0.s >= 0 && sig_0.s <= __compactRuntime.MAX_SECP256K1_SCALAR)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_k256',
                                     'argument 15 (argument 16 as invoked from Typescript)',
                                     'account.compact line 2007 char 1',
                                     'struct Secp256k1EcdsaSignature<r: Secp256k1Scalar, s: Secp256k1Scalar>',
                                     sig_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_2.toValue(recipient_0).concat(_descriptor_1.toValue(color_0).concat(_descriptor_10.toValue(amount_0).concat(_descriptor_14.toValue(change_entry_0).concat(_descriptor_1.toValue(enc_pk_0).concat(_descriptor_5.toValue(pk_0).concat(_descriptor_8.toValue(envelope_0).concat(_descriptor_1.toValue(origin_hash_0).concat(_descriptor_8.toValue(slot_0).concat(_descriptor_1.toValue(scope_salt_0).concat(_descriptor_8.toValue(recipient_kind_0).concat(_descriptor_1.toValue(pinned_recipient_0).concat(_descriptor_10.toValue(max_coin_value_0).concat(_descriptor_10.toValue(spent_prev_0).concat(_descriptor_7.toValue(sig_0))))))))))))))),
            alignment: _descriptor_2.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_14.alignment().concat(_descriptor_1.alignment().concat(_descriptor_5.alignment().concat(_descriptor_8.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_10.alignment().concat(_descriptor_7.alignment()))))))))))))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._withdraw_shielded_to_contract_with_grant_k256_0(context,
                                                                                     partialProofData,
                                                                                     recipient_0,
                                                                                     color_0,
                                                                                     amount_0,
                                                                                     change_entry_0,
                                                                                     enc_pk_0,
                                                                                     pk_0,
                                                                                     envelope_0,
                                                                                     origin_hash_0,
                                                                                     slot_0,
                                                                                     scope_salt_0,
                                                                                     recipient_kind_0,
                                                                                     pinned_recipient_0,
                                                                                     max_coin_value_0,
                                                                                     spent_prev_0,
                                                                                     sig_0);
        partialProofData.output = { value: _descriptor_17.toValue(result_0), alignment: _descriptor_17.alignment() };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      withdraw_unshielded_with_grant_jubjub: async (...args_1) => {
        if (args_1.length !== 15) {
          throw new __compactRuntime.CompactError(`withdraw_unshielded_with_grant_jubjub: expected 15 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const color_0 = args_1[1];
        const amount_0 = args_1[2];
        const recipient_0 = args_1[3];
        const pk_0 = args_1[4];
        const origin_hash_0 = args_1[5];
        const slot_0 = args_1[6];
        const scope_salt_0 = args_1[7];
        const recipient_kind_0 = args_1[8];
        const pinned_recipient_0 = args_1[9];
        const max_coin_value_0 = args_1[10];
        const spent_prev_0 = args_1[11];
        const sig_r_0 = args_1[12];
        const sig_s_0 = args_1[13];
        const grind_nonce_0 = args_1[14];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_jubjub',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 2050 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_jubjub',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 2050 char 1',
                                     'Bytes<32>',
                                     color_0)
        }
        if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_jubjub',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 2050 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     amount_0)
        }
        if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_jubjub',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 2050 char 1',
                                     'struct UserAddress<bytes: Bytes<32>>',
                                     recipient_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_jubjub',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 2050 char 1',
                                     'JubjubPoint',
                                     pk_0)
        }
        if (!(origin_hash_0.buffer instanceof ArrayBuffer && origin_hash_0.BYTES_PER_ELEMENT === 1 && origin_hash_0.length === 32)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_jubjub',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 2050 char 1',
                                     'Bytes<32>',
                                     origin_hash_0)
        }
        if (!(typeof(slot_0) === 'bigint' && slot_0 >= 0n && slot_0 <= 255n)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_jubjub',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'account.compact line 2050 char 1',
                                     'Uint<0..256>',
                                     slot_0)
        }
        if (!(scope_salt_0.buffer instanceof ArrayBuffer && scope_salt_0.BYTES_PER_ELEMENT === 1 && scope_salt_0.length === 32)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_jubjub',
                                     'argument 7 (argument 8 as invoked from Typescript)',
                                     'account.compact line 2050 char 1',
                                     'Bytes<32>',
                                     scope_salt_0)
        }
        if (!(typeof(recipient_kind_0) === 'bigint' && recipient_kind_0 >= 0n && recipient_kind_0 <= 255n)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_jubjub',
                                     'argument 8 (argument 9 as invoked from Typescript)',
                                     'account.compact line 2050 char 1',
                                     'Uint<0..256>',
                                     recipient_kind_0)
        }
        if (!(pinned_recipient_0.buffer instanceof ArrayBuffer && pinned_recipient_0.BYTES_PER_ELEMENT === 1 && pinned_recipient_0.length === 32)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_jubjub',
                                     'argument 9 (argument 10 as invoked from Typescript)',
                                     'account.compact line 2050 char 1',
                                     'Bytes<32>',
                                     pinned_recipient_0)
        }
        if (!(typeof(max_coin_value_0) === 'bigint' && max_coin_value_0 >= 0n && max_coin_value_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_jubjub',
                                     'argument 10 (argument 11 as invoked from Typescript)',
                                     'account.compact line 2050 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     max_coin_value_0)
        }
        if (!(typeof(spent_prev_0) === 'bigint' && spent_prev_0 >= 0n && spent_prev_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_jubjub',
                                     'argument 11 (argument 12 as invoked from Typescript)',
                                     'account.compact line 2050 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     spent_prev_0)
        }
        if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_jubjub',
                                     'argument 12 (argument 13 as invoked from Typescript)',
                                     'account.compact line 2050 char 1',
                                     'JubjubPoint',
                                     sig_r_0)
        }
        if (!(typeof(sig_s_0) === 'bigint' && sig_s_0 >= 0 && sig_s_0 <= __compactRuntime.MAX_FIELD)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_jubjub',
                                     'argument 13 (argument 14 as invoked from Typescript)',
                                     'account.compact line 2050 char 1',
                                     'Field',
                                     sig_s_0)
        }
        if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('withdraw_unshielded_with_grant_jubjub',
                                     'argument 14 (argument 15 as invoked from Typescript)',
                                     'account.compact line 2050 char 1',
                                     'Uint<0..18446744073709551616>',
                                     grind_nonce_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_1.toValue(color_0).concat(_descriptor_10.toValue(amount_0).concat(_descriptor_18.toValue(recipient_0).concat(_descriptor_3.toValue(pk_0).concat(_descriptor_1.toValue(origin_hash_0).concat(_descriptor_8.toValue(slot_0).concat(_descriptor_1.toValue(scope_salt_0).concat(_descriptor_8.toValue(recipient_kind_0).concat(_descriptor_1.toValue(pinned_recipient_0).concat(_descriptor_10.toValue(max_coin_value_0).concat(_descriptor_10.toValue(spent_prev_0).concat(_descriptor_3.toValue(sig_r_0).concat(_descriptor_4.toValue(sig_s_0).concat(_descriptor_0.toValue(grind_nonce_0)))))))))))))),
            alignment: _descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_18.alignment().concat(_descriptor_3.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_10.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment().concat(_descriptor_0.alignment())))))))))))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._withdraw_unshielded_with_grant_jubjub_0(context,
                                                                             partialProofData,
                                                                             color_0,
                                                                             amount_0,
                                                                             recipient_0,
                                                                             pk_0,
                                                                             origin_hash_0,
                                                                             slot_0,
                                                                             scope_salt_0,
                                                                             recipient_kind_0,
                                                                             pinned_recipient_0,
                                                                             max_coin_value_0,
                                                                             spent_prev_0,
                                                                             sig_r_0,
                                                                             sig_s_0,
                                                                             grind_nonce_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      withdraw_shielded_with_grant_jubjub: async (...args_1) => {
        if (args_1.length !== 17) {
          throw new __compactRuntime.CompactError(`withdraw_shielded_with_grant_jubjub: expected 17 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const recipient_0 = args_1[1];
        const color_0 = args_1[2];
        const amount_0 = args_1[3];
        const change_entry_0 = args_1[4];
        const enc_pk_0 = args_1[5];
        const pk_0 = args_1[6];
        const origin_hash_0 = args_1[7];
        const slot_0 = args_1[8];
        const scope_salt_0 = args_1[9];
        const recipient_kind_0 = args_1[10];
        const pinned_recipient_0 = args_1[11];
        const max_coin_value_0 = args_1[12];
        const spent_prev_0 = args_1[13];
        const sig_r_0 = args_1[14];
        const sig_s_0 = args_1[15];
        const grind_nonce_0 = args_1[16];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_jubjub',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 2079 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_jubjub',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 2079 char 1',
                                     'struct ZswapCoinPublicKey<bytes: Bytes<32>>',
                                     recipient_0)
        }
        if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_jubjub',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 2079 char 1',
                                     'Bytes<32>',
                                     color_0)
        }
        if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_jubjub',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 2079 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     amount_0)
        }
        if (!(change_entry_0.buffer instanceof ArrayBuffer && change_entry_0.BYTES_PER_ELEMENT === 1 && change_entry_0.length === 192)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_jubjub',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 2079 char 1',
                                     'Bytes<192>',
                                     change_entry_0)
        }
        if (!(enc_pk_0.buffer instanceof ArrayBuffer && enc_pk_0.BYTES_PER_ELEMENT === 1 && enc_pk_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_jubjub',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 2079 char 1',
                                     'Bytes<32>',
                                     enc_pk_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_jubjub',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'account.compact line 2079 char 1',
                                     'JubjubPoint',
                                     pk_0)
        }
        if (!(origin_hash_0.buffer instanceof ArrayBuffer && origin_hash_0.BYTES_PER_ELEMENT === 1 && origin_hash_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_jubjub',
                                     'argument 7 (argument 8 as invoked from Typescript)',
                                     'account.compact line 2079 char 1',
                                     'Bytes<32>',
                                     origin_hash_0)
        }
        if (!(typeof(slot_0) === 'bigint' && slot_0 >= 0n && slot_0 <= 255n)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_jubjub',
                                     'argument 8 (argument 9 as invoked from Typescript)',
                                     'account.compact line 2079 char 1',
                                     'Uint<0..256>',
                                     slot_0)
        }
        if (!(scope_salt_0.buffer instanceof ArrayBuffer && scope_salt_0.BYTES_PER_ELEMENT === 1 && scope_salt_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_jubjub',
                                     'argument 9 (argument 10 as invoked from Typescript)',
                                     'account.compact line 2079 char 1',
                                     'Bytes<32>',
                                     scope_salt_0)
        }
        if (!(typeof(recipient_kind_0) === 'bigint' && recipient_kind_0 >= 0n && recipient_kind_0 <= 255n)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_jubjub',
                                     'argument 10 (argument 11 as invoked from Typescript)',
                                     'account.compact line 2079 char 1',
                                     'Uint<0..256>',
                                     recipient_kind_0)
        }
        if (!(pinned_recipient_0.buffer instanceof ArrayBuffer && pinned_recipient_0.BYTES_PER_ELEMENT === 1 && pinned_recipient_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_jubjub',
                                     'argument 11 (argument 12 as invoked from Typescript)',
                                     'account.compact line 2079 char 1',
                                     'Bytes<32>',
                                     pinned_recipient_0)
        }
        if (!(typeof(max_coin_value_0) === 'bigint' && max_coin_value_0 >= 0n && max_coin_value_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_jubjub',
                                     'argument 12 (argument 13 as invoked from Typescript)',
                                     'account.compact line 2079 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     max_coin_value_0)
        }
        if (!(typeof(spent_prev_0) === 'bigint' && spent_prev_0 >= 0n && spent_prev_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_jubjub',
                                     'argument 13 (argument 14 as invoked from Typescript)',
                                     'account.compact line 2079 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     spent_prev_0)
        }
        if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_jubjub',
                                     'argument 14 (argument 15 as invoked from Typescript)',
                                     'account.compact line 2079 char 1',
                                     'JubjubPoint',
                                     sig_r_0)
        }
        if (!(typeof(sig_s_0) === 'bigint' && sig_s_0 >= 0 && sig_s_0 <= __compactRuntime.MAX_FIELD)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_jubjub',
                                     'argument 15 (argument 16 as invoked from Typescript)',
                                     'account.compact line 2079 char 1',
                                     'Field',
                                     sig_s_0)
        }
        if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('withdraw_shielded_with_grant_jubjub',
                                     'argument 16 (argument 17 as invoked from Typescript)',
                                     'account.compact line 2079 char 1',
                                     'Uint<0..18446744073709551616>',
                                     grind_nonce_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_19.toValue(recipient_0).concat(_descriptor_1.toValue(color_0).concat(_descriptor_10.toValue(amount_0).concat(_descriptor_14.toValue(change_entry_0).concat(_descriptor_1.toValue(enc_pk_0).concat(_descriptor_3.toValue(pk_0).concat(_descriptor_1.toValue(origin_hash_0).concat(_descriptor_8.toValue(slot_0).concat(_descriptor_1.toValue(scope_salt_0).concat(_descriptor_8.toValue(recipient_kind_0).concat(_descriptor_1.toValue(pinned_recipient_0).concat(_descriptor_10.toValue(max_coin_value_0).concat(_descriptor_10.toValue(spent_prev_0).concat(_descriptor_3.toValue(sig_r_0).concat(_descriptor_4.toValue(sig_s_0).concat(_descriptor_0.toValue(grind_nonce_0)))))))))))))))),
            alignment: _descriptor_19.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_14.alignment().concat(_descriptor_1.alignment().concat(_descriptor_3.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_10.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment().concat(_descriptor_0.alignment())))))))))))))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._withdraw_shielded_with_grant_jubjub_0(context,
                                                                           partialProofData,
                                                                           recipient_0,
                                                                           color_0,
                                                                           amount_0,
                                                                           change_entry_0,
                                                                           enc_pk_0,
                                                                           pk_0,
                                                                           origin_hash_0,
                                                                           slot_0,
                                                                           scope_salt_0,
                                                                           recipient_kind_0,
                                                                           pinned_recipient_0,
                                                                           max_coin_value_0,
                                                                           spent_prev_0,
                                                                           sig_r_0,
                                                                           sig_s_0,
                                                                           grind_nonce_0);
        partialProofData.output = { value: _descriptor_16.toValue(result_0), alignment: _descriptor_16.alignment() };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      withdraw_shielded_to_contract_with_grant_jubjub: async (...args_1) => {
        if (args_1.length !== 17) {
          throw new __compactRuntime.CompactError(`withdraw_shielded_to_contract_with_grant_jubjub: expected 17 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const recipient_0 = args_1[1];
        const color_0 = args_1[2];
        const amount_0 = args_1[3];
        const change_entry_0 = args_1[4];
        const enc_pk_0 = args_1[5];
        const pk_0 = args_1[6];
        const origin_hash_0 = args_1[7];
        const slot_0 = args_1[8];
        const scope_salt_0 = args_1[9];
        const recipient_kind_0 = args_1[10];
        const pinned_recipient_0 = args_1[11];
        const max_coin_value_0 = args_1[12];
        const spent_prev_0 = args_1[13];
        const sig_r_0 = args_1[14];
        const sig_s_0 = args_1[15];
        const grind_nonce_0 = args_1[16];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_jubjub',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 2117 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_jubjub',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 2117 char 1',
                                     'struct ContractAddress<bytes: Bytes<32>>',
                                     recipient_0)
        }
        if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_jubjub',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 2117 char 1',
                                     'Bytes<32>',
                                     color_0)
        }
        if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_jubjub',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 2117 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     amount_0)
        }
        if (!(change_entry_0.buffer instanceof ArrayBuffer && change_entry_0.BYTES_PER_ELEMENT === 1 && change_entry_0.length === 192)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_jubjub',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 2117 char 1',
                                     'Bytes<192>',
                                     change_entry_0)
        }
        if (!(enc_pk_0.buffer instanceof ArrayBuffer && enc_pk_0.BYTES_PER_ELEMENT === 1 && enc_pk_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_jubjub',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 2117 char 1',
                                     'Bytes<32>',
                                     enc_pk_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_jubjub',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'account.compact line 2117 char 1',
                                     'JubjubPoint',
                                     pk_0)
        }
        if (!(origin_hash_0.buffer instanceof ArrayBuffer && origin_hash_0.BYTES_PER_ELEMENT === 1 && origin_hash_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_jubjub',
                                     'argument 7 (argument 8 as invoked from Typescript)',
                                     'account.compact line 2117 char 1',
                                     'Bytes<32>',
                                     origin_hash_0)
        }
        if (!(typeof(slot_0) === 'bigint' && slot_0 >= 0n && slot_0 <= 255n)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_jubjub',
                                     'argument 8 (argument 9 as invoked from Typescript)',
                                     'account.compact line 2117 char 1',
                                     'Uint<0..256>',
                                     slot_0)
        }
        if (!(scope_salt_0.buffer instanceof ArrayBuffer && scope_salt_0.BYTES_PER_ELEMENT === 1 && scope_salt_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_jubjub',
                                     'argument 9 (argument 10 as invoked from Typescript)',
                                     'account.compact line 2117 char 1',
                                     'Bytes<32>',
                                     scope_salt_0)
        }
        if (!(typeof(recipient_kind_0) === 'bigint' && recipient_kind_0 >= 0n && recipient_kind_0 <= 255n)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_jubjub',
                                     'argument 10 (argument 11 as invoked from Typescript)',
                                     'account.compact line 2117 char 1',
                                     'Uint<0..256>',
                                     recipient_kind_0)
        }
        if (!(pinned_recipient_0.buffer instanceof ArrayBuffer && pinned_recipient_0.BYTES_PER_ELEMENT === 1 && pinned_recipient_0.length === 32)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_jubjub',
                                     'argument 11 (argument 12 as invoked from Typescript)',
                                     'account.compact line 2117 char 1',
                                     'Bytes<32>',
                                     pinned_recipient_0)
        }
        if (!(typeof(max_coin_value_0) === 'bigint' && max_coin_value_0 >= 0n && max_coin_value_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_jubjub',
                                     'argument 12 (argument 13 as invoked from Typescript)',
                                     'account.compact line 2117 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     max_coin_value_0)
        }
        if (!(typeof(spent_prev_0) === 'bigint' && spent_prev_0 >= 0n && spent_prev_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_jubjub',
                                     'argument 13 (argument 14 as invoked from Typescript)',
                                     'account.compact line 2117 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     spent_prev_0)
        }
        if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_jubjub',
                                     'argument 14 (argument 15 as invoked from Typescript)',
                                     'account.compact line 2117 char 1',
                                     'JubjubPoint',
                                     sig_r_0)
        }
        if (!(typeof(sig_s_0) === 'bigint' && sig_s_0 >= 0 && sig_s_0 <= __compactRuntime.MAX_FIELD)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_jubjub',
                                     'argument 15 (argument 16 as invoked from Typescript)',
                                     'account.compact line 2117 char 1',
                                     'Field',
                                     sig_s_0)
        }
        if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('withdraw_shielded_to_contract_with_grant_jubjub',
                                     'argument 16 (argument 17 as invoked from Typescript)',
                                     'account.compact line 2117 char 1',
                                     'Uint<0..18446744073709551616>',
                                     grind_nonce_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_2.toValue(recipient_0).concat(_descriptor_1.toValue(color_0).concat(_descriptor_10.toValue(amount_0).concat(_descriptor_14.toValue(change_entry_0).concat(_descriptor_1.toValue(enc_pk_0).concat(_descriptor_3.toValue(pk_0).concat(_descriptor_1.toValue(origin_hash_0).concat(_descriptor_8.toValue(slot_0).concat(_descriptor_1.toValue(scope_salt_0).concat(_descriptor_8.toValue(recipient_kind_0).concat(_descriptor_1.toValue(pinned_recipient_0).concat(_descriptor_10.toValue(max_coin_value_0).concat(_descriptor_10.toValue(spent_prev_0).concat(_descriptor_3.toValue(sig_r_0).concat(_descriptor_4.toValue(sig_s_0).concat(_descriptor_0.toValue(grind_nonce_0)))))))))))))))),
            alignment: _descriptor_2.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_14.alignment().concat(_descriptor_1.alignment().concat(_descriptor_3.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_10.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment().concat(_descriptor_0.alignment())))))))))))))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._withdraw_shielded_to_contract_with_grant_jubjub_0(context,
                                                                                       partialProofData,
                                                                                       recipient_0,
                                                                                       color_0,
                                                                                       amount_0,
                                                                                       change_entry_0,
                                                                                       enc_pk_0,
                                                                                       pk_0,
                                                                                       origin_hash_0,
                                                                                       slot_0,
                                                                                       scope_salt_0,
                                                                                       recipient_kind_0,
                                                                                       pinned_recipient_0,
                                                                                       max_coin_value_0,
                                                                                       spent_prev_0,
                                                                                       sig_r_0,
                                                                                       sig_s_0,
                                                                                       grind_nonce_0);
        partialProofData.output = { value: _descriptor_17.toValue(result_0), alignment: _descriptor_17.alignment() };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      issue_grant_with_k256: async (...args_1) => {
        if (args_1.length !== 22) {
          throw new __compactRuntime.CompactError(`issue_grant_with_k256: expected 22 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const grant_id_0 = args_1[1];
        const op_withdraw_unshielded_0 = args_1[2];
        const op_withdraw_shielded_0 = args_1[3];
        const op_withdraw_shielded_to_contract_0 = args_1[4];
        const read_0 = args_1[5];
        const color_0 = args_1[6];
        const recipient_kind_0 = args_1[7];
        const recipient_0 = args_1[8];
        const max_coin_value_0 = args_1[9];
        const per_call_cap_0 = args_1[10];
        const cap_0 = args_1[11];
        const expires_at_0 = args_1[12];
        const rp_id_hash_0 = args_1[13];
        const read_pk_hash_0 = args_1[14];
        const window_len_0 = args_1[15];
        const window_cap_0 = args_1[16];
        const scope_salt_0 = args_1[17];
        const pk_0 = args_1[18];
        const use_counter_0 = args_1[19];
        const sig_0 = args_1[20];
        const envelope_0 = args_1[21];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(grant_id_0.buffer instanceof ArrayBuffer && grant_id_0.BYTES_PER_ELEMENT === 1 && grant_id_0.length === 32)) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'Bytes<32>',
                                     grant_id_0)
        }
        if (!(typeof(op_withdraw_unshielded_0) === 'boolean')) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'Boolean',
                                     op_withdraw_unshielded_0)
        }
        if (!(typeof(op_withdraw_shielded_0) === 'boolean')) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'Boolean',
                                     op_withdraw_shielded_0)
        }
        if (!(typeof(op_withdraw_shielded_to_contract_0) === 'boolean')) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'Boolean',
                                     op_withdraw_shielded_to_contract_0)
        }
        if (!(typeof(read_0) === 'boolean')) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'Boolean',
                                     read_0)
        }
        if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'Bytes<32>',
                                     color_0)
        }
        if (!(typeof(recipient_kind_0) === 'bigint' && recipient_kind_0 >= 0n && recipient_kind_0 <= 255n)) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 7 (argument 8 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'Uint<0..256>',
                                     recipient_kind_0)
        }
        if (!(recipient_0.buffer instanceof ArrayBuffer && recipient_0.BYTES_PER_ELEMENT === 1 && recipient_0.length === 32)) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 8 (argument 9 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'Bytes<32>',
                                     recipient_0)
        }
        if (!(typeof(max_coin_value_0) === 'bigint' && max_coin_value_0 >= 0n && max_coin_value_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 9 (argument 10 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     max_coin_value_0)
        }
        if (!(typeof(per_call_cap_0) === 'bigint' && per_call_cap_0 >= 0n && per_call_cap_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 10 (argument 11 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     per_call_cap_0)
        }
        if (!(typeof(cap_0) === 'bigint' && cap_0 >= 0n && cap_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 11 (argument 12 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     cap_0)
        }
        if (!(typeof(expires_at_0) === 'bigint' && expires_at_0 >= 0n && expires_at_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 12 (argument 13 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'Uint<0..18446744073709551616>',
                                     expires_at_0)
        }
        if (!(rp_id_hash_0.buffer instanceof ArrayBuffer && rp_id_hash_0.BYTES_PER_ELEMENT === 1 && rp_id_hash_0.length === 32)) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 13 (argument 14 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'Bytes<32>',
                                     rp_id_hash_0)
        }
        if (!(read_pk_hash_0.buffer instanceof ArrayBuffer && read_pk_hash_0.BYTES_PER_ELEMENT === 1 && read_pk_hash_0.length === 32)) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 14 (argument 15 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'Bytes<32>',
                                     read_pk_hash_0)
        }
        if (!(typeof(window_len_0) === 'bigint' && window_len_0 >= 0n && window_len_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 15 (argument 16 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'Uint<0..18446744073709551616>',
                                     window_len_0)
        }
        if (!(typeof(window_cap_0) === 'bigint' && window_cap_0 >= 0n && window_cap_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 16 (argument 17 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     window_cap_0)
        }
        if (!(scope_salt_0.buffer instanceof ArrayBuffer && scope_salt_0.BYTES_PER_ELEMENT === 1 && scope_salt_0.length === 32)) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 17 (argument 18 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'Bytes<32>',
                                     scope_salt_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 18 (argument 19 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'Secp256k1Point',
                                     pk_0)
        }
        if (!(typeof(use_counter_0) === 'bigint' && use_counter_0 >= 0n && use_counter_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 19 (argument 20 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'Uint<0..18446744073709551616>',
                                     use_counter_0)
        }
        if (!(typeof(sig_0) === 'object' && typeof(sig_0.r) === 'bigint' && sig_0.r >= 0 && sig_0.r <= __compactRuntime.MAX_SECP256K1_SCALAR && typeof(sig_0.s) === 'bigint' && sig_0.s >= 0 && sig_0.s <= __compactRuntime.MAX_SECP256K1_SCALAR)) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 20 (argument 21 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'struct Secp256k1EcdsaSignature<r: Secp256k1Scalar, s: Secp256k1Scalar>',
                                     sig_0)
        }
        if (!(typeof(envelope_0) === 'bigint' && envelope_0 >= 0n && envelope_0 <= 255n)) {
          __compactRuntime.typeError('issue_grant_with_k256',
                                     'argument 21 (argument 22 as invoked from Typescript)',
                                     'account.compact line 2263 char 1',
                                     'Uint<0..256>',
                                     envelope_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_1.toValue(grant_id_0).concat(_descriptor_9.toValue(op_withdraw_unshielded_0).concat(_descriptor_9.toValue(op_withdraw_shielded_0).concat(_descriptor_9.toValue(op_withdraw_shielded_to_contract_0).concat(_descriptor_9.toValue(read_0).concat(_descriptor_1.toValue(color_0).concat(_descriptor_8.toValue(recipient_kind_0).concat(_descriptor_1.toValue(recipient_0).concat(_descriptor_10.toValue(max_coin_value_0).concat(_descriptor_10.toValue(per_call_cap_0).concat(_descriptor_10.toValue(cap_0).concat(_descriptor_0.toValue(expires_at_0).concat(_descriptor_1.toValue(rp_id_hash_0).concat(_descriptor_1.toValue(read_pk_hash_0).concat(_descriptor_0.toValue(window_len_0).concat(_descriptor_10.toValue(window_cap_0).concat(_descriptor_1.toValue(scope_salt_0).concat(_descriptor_5.toValue(pk_0).concat(_descriptor_0.toValue(use_counter_0).concat(_descriptor_7.toValue(sig_0).concat(_descriptor_8.toValue(envelope_0))))))))))))))))))))),
            alignment: _descriptor_1.alignment().concat(_descriptor_9.alignment().concat(_descriptor_9.alignment().concat(_descriptor_9.alignment().concat(_descriptor_9.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_10.alignment().concat(_descriptor_10.alignment().concat(_descriptor_0.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_0.alignment().concat(_descriptor_10.alignment().concat(_descriptor_1.alignment().concat(_descriptor_5.alignment().concat(_descriptor_0.alignment().concat(_descriptor_7.alignment().concat(_descriptor_8.alignment()))))))))))))))))))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._issue_grant_with_k256_0(context,
                                                             partialProofData,
                                                             grant_id_0,
                                                             op_withdraw_unshielded_0,
                                                             op_withdraw_shielded_0,
                                                             op_withdraw_shielded_to_contract_0,
                                                             read_0,
                                                             color_0,
                                                             recipient_kind_0,
                                                             recipient_0,
                                                             max_coin_value_0,
                                                             per_call_cap_0,
                                                             cap_0,
                                                             expires_at_0,
                                                             rp_id_hash_0,
                                                             read_pk_hash_0,
                                                             window_len_0,
                                                             window_cap_0,
                                                             scope_salt_0,
                                                             pk_0,
                                                             use_counter_0,
                                                             sig_0,
                                                             envelope_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      revoke_grant_with_k256: async (...args_1) => {
        if (args_1.length !== 6) {
          throw new __compactRuntime.CompactError(`revoke_grant_with_k256: expected 6 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const grant_id_0 = args_1[1];
        const pk_0 = args_1[2];
        const use_counter_0 = args_1[3];
        const sig_0 = args_1[4];
        const envelope_0 = args_1[5];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('revoke_grant_with_k256',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 2304 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(grant_id_0.buffer instanceof ArrayBuffer && grant_id_0.BYTES_PER_ELEMENT === 1 && grant_id_0.length === 32)) {
          __compactRuntime.typeError('revoke_grant_with_k256',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 2304 char 1',
                                     'Bytes<32>',
                                     grant_id_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
          __compactRuntime.typeError('revoke_grant_with_k256',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 2304 char 1',
                                     'Secp256k1Point',
                                     pk_0)
        }
        if (!(typeof(use_counter_0) === 'bigint' && use_counter_0 >= 0n && use_counter_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('revoke_grant_with_k256',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 2304 char 1',
                                     'Uint<0..18446744073709551616>',
                                     use_counter_0)
        }
        if (!(typeof(sig_0) === 'object' && typeof(sig_0.r) === 'bigint' && sig_0.r >= 0 && sig_0.r <= __compactRuntime.MAX_SECP256K1_SCALAR && typeof(sig_0.s) === 'bigint' && sig_0.s >= 0 && sig_0.s <= __compactRuntime.MAX_SECP256K1_SCALAR)) {
          __compactRuntime.typeError('revoke_grant_with_k256',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 2304 char 1',
                                     'struct Secp256k1EcdsaSignature<r: Secp256k1Scalar, s: Secp256k1Scalar>',
                                     sig_0)
        }
        if (!(typeof(envelope_0) === 'bigint' && envelope_0 >= 0n && envelope_0 <= 255n)) {
          __compactRuntime.typeError('revoke_grant_with_k256',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 2304 char 1',
                                     'Uint<0..256>',
                                     envelope_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_1.toValue(grant_id_0).concat(_descriptor_5.toValue(pk_0).concat(_descriptor_0.toValue(use_counter_0).concat(_descriptor_7.toValue(sig_0).concat(_descriptor_8.toValue(envelope_0))))),
            alignment: _descriptor_1.alignment().concat(_descriptor_5.alignment().concat(_descriptor_0.alignment().concat(_descriptor_7.alignment().concat(_descriptor_8.alignment()))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._revoke_grant_with_k256_0(context,
                                                              partialProofData,
                                                              grant_id_0,
                                                              pk_0,
                                                              use_counter_0,
                                                              sig_0,
                                                              envelope_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      revoke_all_grants_with_k256: async (...args_1) => {
        if (args_1.length !== 5) {
          throw new __compactRuntime.CompactError(`revoke_all_grants_with_k256: expected 5 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const pk_0 = args_1[1];
        const use_counter_0 = args_1[2];
        const sig_0 = args_1[3];
        const envelope_0 = args_1[4];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('revoke_all_grants_with_k256',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 2318 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
          __compactRuntime.typeError('revoke_all_grants_with_k256',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 2318 char 1',
                                     'Secp256k1Point',
                                     pk_0)
        }
        if (!(typeof(use_counter_0) === 'bigint' && use_counter_0 >= 0n && use_counter_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('revoke_all_grants_with_k256',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 2318 char 1',
                                     'Uint<0..18446744073709551616>',
                                     use_counter_0)
        }
        if (!(typeof(sig_0) === 'object' && typeof(sig_0.r) === 'bigint' && sig_0.r >= 0 && sig_0.r <= __compactRuntime.MAX_SECP256K1_SCALAR && typeof(sig_0.s) === 'bigint' && sig_0.s >= 0 && sig_0.s <= __compactRuntime.MAX_SECP256K1_SCALAR)) {
          __compactRuntime.typeError('revoke_all_grants_with_k256',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 2318 char 1',
                                     'struct Secp256k1EcdsaSignature<r: Secp256k1Scalar, s: Secp256k1Scalar>',
                                     sig_0)
        }
        if (!(typeof(envelope_0) === 'bigint' && envelope_0 >= 0n && envelope_0 <= 255n)) {
          __compactRuntime.typeError('revoke_all_grants_with_k256',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 2318 char 1',
                                     'Uint<0..256>',
                                     envelope_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_5.toValue(pk_0).concat(_descriptor_0.toValue(use_counter_0).concat(_descriptor_7.toValue(sig_0).concat(_descriptor_8.toValue(envelope_0)))),
            alignment: _descriptor_5.alignment().concat(_descriptor_0.alignment().concat(_descriptor_7.alignment().concat(_descriptor_8.alignment())))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._revoke_all_grants_with_k256_0(context,
                                                                   partialProofData,
                                                                   pk_0,
                                                                   use_counter_0,
                                                                   sig_0,
                                                                   envelope_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      issue_grant_with_jubjub: async (...args_1) => {
        if (args_1.length !== 23) {
          throw new __compactRuntime.CompactError(`issue_grant_with_jubjub: expected 23 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const grant_id_0 = args_1[1];
        const op_withdraw_unshielded_0 = args_1[2];
        const op_withdraw_shielded_0 = args_1[3];
        const op_withdraw_shielded_to_contract_0 = args_1[4];
        const read_0 = args_1[5];
        const color_0 = args_1[6];
        const recipient_kind_0 = args_1[7];
        const recipient_0 = args_1[8];
        const max_coin_value_0 = args_1[9];
        const per_call_cap_0 = args_1[10];
        const cap_0 = args_1[11];
        const expires_at_0 = args_1[12];
        const rp_id_hash_0 = args_1[13];
        const read_pk_hash_0 = args_1[14];
        const window_len_0 = args_1[15];
        const window_cap_0 = args_1[16];
        const scope_salt_0 = args_1[17];
        const pk_0 = args_1[18];
        const use_counter_0 = args_1[19];
        const sig_r_0 = args_1[20];
        const sig_s_0 = args_1[21];
        const grind_nonce_0 = args_1[22];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(grant_id_0.buffer instanceof ArrayBuffer && grant_id_0.BYTES_PER_ELEMENT === 1 && grant_id_0.length === 32)) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'Bytes<32>',
                                     grant_id_0)
        }
        if (!(typeof(op_withdraw_unshielded_0) === 'boolean')) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'Boolean',
                                     op_withdraw_unshielded_0)
        }
        if (!(typeof(op_withdraw_shielded_0) === 'boolean')) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'Boolean',
                                     op_withdraw_shielded_0)
        }
        if (!(typeof(op_withdraw_shielded_to_contract_0) === 'boolean')) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'Boolean',
                                     op_withdraw_shielded_to_contract_0)
        }
        if (!(typeof(read_0) === 'boolean')) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'Boolean',
                                     read_0)
        }
        if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'Bytes<32>',
                                     color_0)
        }
        if (!(typeof(recipient_kind_0) === 'bigint' && recipient_kind_0 >= 0n && recipient_kind_0 <= 255n)) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 7 (argument 8 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'Uint<0..256>',
                                     recipient_kind_0)
        }
        if (!(recipient_0.buffer instanceof ArrayBuffer && recipient_0.BYTES_PER_ELEMENT === 1 && recipient_0.length === 32)) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 8 (argument 9 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'Bytes<32>',
                                     recipient_0)
        }
        if (!(typeof(max_coin_value_0) === 'bigint' && max_coin_value_0 >= 0n && max_coin_value_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 9 (argument 10 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     max_coin_value_0)
        }
        if (!(typeof(per_call_cap_0) === 'bigint' && per_call_cap_0 >= 0n && per_call_cap_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 10 (argument 11 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     per_call_cap_0)
        }
        if (!(typeof(cap_0) === 'bigint' && cap_0 >= 0n && cap_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 11 (argument 12 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     cap_0)
        }
        if (!(typeof(expires_at_0) === 'bigint' && expires_at_0 >= 0n && expires_at_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 12 (argument 13 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'Uint<0..18446744073709551616>',
                                     expires_at_0)
        }
        if (!(rp_id_hash_0.buffer instanceof ArrayBuffer && rp_id_hash_0.BYTES_PER_ELEMENT === 1 && rp_id_hash_0.length === 32)) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 13 (argument 14 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'Bytes<32>',
                                     rp_id_hash_0)
        }
        if (!(read_pk_hash_0.buffer instanceof ArrayBuffer && read_pk_hash_0.BYTES_PER_ELEMENT === 1 && read_pk_hash_0.length === 32)) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 14 (argument 15 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'Bytes<32>',
                                     read_pk_hash_0)
        }
        if (!(typeof(window_len_0) === 'bigint' && window_len_0 >= 0n && window_len_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 15 (argument 16 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'Uint<0..18446744073709551616>',
                                     window_len_0)
        }
        if (!(typeof(window_cap_0) === 'bigint' && window_cap_0 >= 0n && window_cap_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 16 (argument 17 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     window_cap_0)
        }
        if (!(scope_salt_0.buffer instanceof ArrayBuffer && scope_salt_0.BYTES_PER_ELEMENT === 1 && scope_salt_0.length === 32)) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 17 (argument 18 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'Bytes<32>',
                                     scope_salt_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 18 (argument 19 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'JubjubPoint',
                                     pk_0)
        }
        if (!(typeof(use_counter_0) === 'bigint' && use_counter_0 >= 0n && use_counter_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 19 (argument 20 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'Uint<0..18446744073709551616>',
                                     use_counter_0)
        }
        if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 20 (argument 21 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'JubjubPoint',
                                     sig_r_0)
        }
        if (!(typeof(sig_s_0) === 'bigint' && sig_s_0 >= 0 && sig_s_0 <= __compactRuntime.MAX_FIELD)) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 21 (argument 22 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'Field',
                                     sig_s_0)
        }
        if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('issue_grant_with_jubjub',
                                     'argument 22 (argument 23 as invoked from Typescript)',
                                     'account.compact line 2336 char 1',
                                     'Uint<0..18446744073709551616>',
                                     grind_nonce_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_1.toValue(grant_id_0).concat(_descriptor_9.toValue(op_withdraw_unshielded_0).concat(_descriptor_9.toValue(op_withdraw_shielded_0).concat(_descriptor_9.toValue(op_withdraw_shielded_to_contract_0).concat(_descriptor_9.toValue(read_0).concat(_descriptor_1.toValue(color_0).concat(_descriptor_8.toValue(recipient_kind_0).concat(_descriptor_1.toValue(recipient_0).concat(_descriptor_10.toValue(max_coin_value_0).concat(_descriptor_10.toValue(per_call_cap_0).concat(_descriptor_10.toValue(cap_0).concat(_descriptor_0.toValue(expires_at_0).concat(_descriptor_1.toValue(rp_id_hash_0).concat(_descriptor_1.toValue(read_pk_hash_0).concat(_descriptor_0.toValue(window_len_0).concat(_descriptor_10.toValue(window_cap_0).concat(_descriptor_1.toValue(scope_salt_0).concat(_descriptor_3.toValue(pk_0).concat(_descriptor_0.toValue(use_counter_0).concat(_descriptor_3.toValue(sig_r_0).concat(_descriptor_4.toValue(sig_s_0).concat(_descriptor_0.toValue(grind_nonce_0)))))))))))))))))))))),
            alignment: _descriptor_1.alignment().concat(_descriptor_9.alignment().concat(_descriptor_9.alignment().concat(_descriptor_9.alignment().concat(_descriptor_9.alignment().concat(_descriptor_1.alignment().concat(_descriptor_8.alignment().concat(_descriptor_1.alignment().concat(_descriptor_10.alignment().concat(_descriptor_10.alignment().concat(_descriptor_10.alignment().concat(_descriptor_0.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_0.alignment().concat(_descriptor_10.alignment().concat(_descriptor_1.alignment().concat(_descriptor_3.alignment().concat(_descriptor_0.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment().concat(_descriptor_0.alignment())))))))))))))))))))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._issue_grant_with_jubjub_0(context,
                                                               partialProofData,
                                                               grant_id_0,
                                                               op_withdraw_unshielded_0,
                                                               op_withdraw_shielded_0,
                                                               op_withdraw_shielded_to_contract_0,
                                                               read_0,
                                                               color_0,
                                                               recipient_kind_0,
                                                               recipient_0,
                                                               max_coin_value_0,
                                                               per_call_cap_0,
                                                               cap_0,
                                                               expires_at_0,
                                                               rp_id_hash_0,
                                                               read_pk_hash_0,
                                                               window_len_0,
                                                               window_cap_0,
                                                               scope_salt_0,
                                                               pk_0,
                                                               use_counter_0,
                                                               sig_r_0,
                                                               sig_s_0,
                                                               grind_nonce_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      revoke_grant_with_jubjub: async (...args_1) => {
        if (args_1.length !== 7) {
          throw new __compactRuntime.CompactError(`revoke_grant_with_jubjub: expected 7 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const grant_id_0 = args_1[1];
        const pk_0 = args_1[2];
        const use_counter_0 = args_1[3];
        const sig_r_0 = args_1[4];
        const sig_s_0 = args_1[5];
        const grind_nonce_0 = args_1[6];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('revoke_grant_with_jubjub',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 2378 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(grant_id_0.buffer instanceof ArrayBuffer && grant_id_0.BYTES_PER_ELEMENT === 1 && grant_id_0.length === 32)) {
          __compactRuntime.typeError('revoke_grant_with_jubjub',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 2378 char 1',
                                     'Bytes<32>',
                                     grant_id_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
          __compactRuntime.typeError('revoke_grant_with_jubjub',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 2378 char 1',
                                     'JubjubPoint',
                                     pk_0)
        }
        if (!(typeof(use_counter_0) === 'bigint' && use_counter_0 >= 0n && use_counter_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('revoke_grant_with_jubjub',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 2378 char 1',
                                     'Uint<0..18446744073709551616>',
                                     use_counter_0)
        }
        if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
          __compactRuntime.typeError('revoke_grant_with_jubjub',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 2378 char 1',
                                     'JubjubPoint',
                                     sig_r_0)
        }
        if (!(typeof(sig_s_0) === 'bigint' && sig_s_0 >= 0 && sig_s_0 <= __compactRuntime.MAX_FIELD)) {
          __compactRuntime.typeError('revoke_grant_with_jubjub',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 2378 char 1',
                                     'Field',
                                     sig_s_0)
        }
        if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('revoke_grant_with_jubjub',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'account.compact line 2378 char 1',
                                     'Uint<0..18446744073709551616>',
                                     grind_nonce_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_1.toValue(grant_id_0).concat(_descriptor_3.toValue(pk_0).concat(_descriptor_0.toValue(use_counter_0).concat(_descriptor_3.toValue(sig_r_0).concat(_descriptor_4.toValue(sig_s_0).concat(_descriptor_0.toValue(grind_nonce_0)))))),
            alignment: _descriptor_1.alignment().concat(_descriptor_3.alignment().concat(_descriptor_0.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment().concat(_descriptor_0.alignment())))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._revoke_grant_with_jubjub_0(context,
                                                                partialProofData,
                                                                grant_id_0,
                                                                pk_0,
                                                                use_counter_0,
                                                                sig_r_0,
                                                                sig_s_0,
                                                                grind_nonce_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      revoke_all_grants_with_jubjub: async (...args_1) => {
        if (args_1.length !== 6) {
          throw new __compactRuntime.CompactError(`revoke_all_grants_with_jubjub: expected 6 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const pk_0 = args_1[1];
        const use_counter_0 = args_1[2];
        const sig_r_0 = args_1[3];
        const sig_s_0 = args_1[4];
        const grind_nonce_0 = args_1[5];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('revoke_all_grants_with_jubjub',
                                     'argument 1 (as invoked from Typescript)',
                                     'account.compact line 2393 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
          __compactRuntime.typeError('revoke_all_grants_with_jubjub',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'account.compact line 2393 char 1',
                                     'JubjubPoint',
                                     pk_0)
        }
        if (!(typeof(use_counter_0) === 'bigint' && use_counter_0 >= 0n && use_counter_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('revoke_all_grants_with_jubjub',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'account.compact line 2393 char 1',
                                     'Uint<0..18446744073709551616>',
                                     use_counter_0)
        }
        if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
          __compactRuntime.typeError('revoke_all_grants_with_jubjub',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'account.compact line 2393 char 1',
                                     'JubjubPoint',
                                     sig_r_0)
        }
        if (!(typeof(sig_s_0) === 'bigint' && sig_s_0 >= 0 && sig_s_0 <= __compactRuntime.MAX_FIELD)) {
          __compactRuntime.typeError('revoke_all_grants_with_jubjub',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'account.compact line 2393 char 1',
                                     'Field',
                                     sig_s_0)
        }
        if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('revoke_all_grants_with_jubjub',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'account.compact line 2393 char 1',
                                     'Uint<0..18446744073709551616>',
                                     grind_nonce_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_3.toValue(pk_0).concat(_descriptor_0.toValue(use_counter_0).concat(_descriptor_3.toValue(sig_r_0).concat(_descriptor_4.toValue(sig_s_0).concat(_descriptor_0.toValue(grind_nonce_0))))),
            alignment: _descriptor_3.alignment().concat(_descriptor_0.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment().concat(_descriptor_0.alignment()))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._revoke_all_grants_with_jubjub_0(context,
                                                                     partialProofData,
                                                                     pk_0,
                                                                     use_counter_0,
                                                                     sig_r_0,
                                                                     sig_s_0,
                                                                     grind_nonce_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      }
    };
    this.impureCircuits = {
      activate_initial_device_with_jubjub: this.circuits.activate_initial_device_with_jubjub,
      activate_initial_device_with_k256: this.circuits.activate_initial_device_with_k256,
      deposit_unshielded: this.circuits.deposit_unshielded,
      withdraw_unshielded_with_jubjub: this.circuits.withdraw_unshielded_with_jubjub,
      withdraw_unshielded_with_k256: this.circuits.withdraw_unshielded_with_k256,
      deposit_shielded: this.circuits.deposit_shielded,
      append_inbox_with_jubjub: this.circuits.append_inbox_with_jubjub,
      append_inbox_with_k256: this.circuits.append_inbox_with_k256,
      withdraw_shielded_with_jubjub: this.circuits.withdraw_shielded_with_jubjub,
      withdraw_shielded_with_k256: this.circuits.withdraw_shielded_with_k256,
      withdraw_shielded_to_contract_with_jubjub: this.circuits.withdraw_shielded_to_contract_with_jubjub,
      withdraw_shielded_to_contract_with_k256: this.circuits.withdraw_shielded_to_contract_with_k256,
      rotate_enc_key_with_jubjub: this.circuits.rotate_enc_key_with_jubjub,
      rotate_enc_key_with_k256: this.circuits.rotate_enc_key_with_k256,
      add_device_with_jubjub: this.circuits.add_device_with_jubjub,
      add_device_with_k256: this.circuits.add_device_with_k256,
      remove_device_with_jubjub: this.circuits.remove_device_with_jubjub,
      remove_device_with_k256: this.circuits.remove_device_with_k256,
      withdraw_unshielded_with_grant_k256: this.circuits.withdraw_unshielded_with_grant_k256,
      withdraw_shielded_with_grant_k256: this.circuits.withdraw_shielded_with_grant_k256,
      withdraw_shielded_to_contract_with_grant_k256: this.circuits.withdraw_shielded_to_contract_with_grant_k256,
      withdraw_unshielded_with_grant_jubjub: this.circuits.withdraw_unshielded_with_grant_jubjub,
      withdraw_shielded_with_grant_jubjub: this.circuits.withdraw_shielded_with_grant_jubjub,
      withdraw_shielded_to_contract_with_grant_jubjub: this.circuits.withdraw_shielded_to_contract_with_grant_jubjub,
      issue_grant_with_k256: this.circuits.issue_grant_with_k256,
      revoke_grant_with_k256: this.circuits.revoke_grant_with_k256,
      revoke_all_grants_with_k256: this.circuits.revoke_all_grants_with_k256,
      issue_grant_with_jubjub: this.circuits.issue_grant_with_jubjub,
      revoke_grant_with_jubjub: this.circuits.revoke_grant_with_jubjub,
      revoke_all_grants_with_jubjub: this.circuits.revoke_all_grants_with_jubjub
    };
    this.provableCircuits = {
      activate_initial_device_with_jubjub: this.circuits.activate_initial_device_with_jubjub,
      activate_initial_device_with_k256: this.circuits.activate_initial_device_with_k256,
      deposit_unshielded: this.circuits.deposit_unshielded,
      withdraw_unshielded_with_jubjub: this.circuits.withdraw_unshielded_with_jubjub,
      withdraw_unshielded_with_k256: this.circuits.withdraw_unshielded_with_k256,
      deposit_shielded: this.circuits.deposit_shielded,
      append_inbox_with_jubjub: this.circuits.append_inbox_with_jubjub,
      append_inbox_with_k256: this.circuits.append_inbox_with_k256,
      withdraw_shielded_with_jubjub: this.circuits.withdraw_shielded_with_jubjub,
      withdraw_shielded_with_k256: this.circuits.withdraw_shielded_with_k256,
      withdraw_shielded_to_contract_with_jubjub: this.circuits.withdraw_shielded_to_contract_with_jubjub,
      withdraw_shielded_to_contract_with_k256: this.circuits.withdraw_shielded_to_contract_with_k256,
      rotate_enc_key_with_jubjub: this.circuits.rotate_enc_key_with_jubjub,
      rotate_enc_key_with_k256: this.circuits.rotate_enc_key_with_k256,
      add_device_with_jubjub: this.circuits.add_device_with_jubjub,
      add_device_with_k256: this.circuits.add_device_with_k256,
      remove_device_with_jubjub: this.circuits.remove_device_with_jubjub,
      remove_device_with_k256: this.circuits.remove_device_with_k256,
      withdraw_unshielded_with_grant_k256: this.circuits.withdraw_unshielded_with_grant_k256,
      withdraw_shielded_with_grant_k256: this.circuits.withdraw_shielded_with_grant_k256,
      withdraw_shielded_to_contract_with_grant_k256: this.circuits.withdraw_shielded_to_contract_with_grant_k256,
      withdraw_unshielded_with_grant_jubjub: this.circuits.withdraw_unshielded_with_grant_jubjub,
      withdraw_shielded_with_grant_jubjub: this.circuits.withdraw_shielded_with_grant_jubjub,
      withdraw_shielded_to_contract_with_grant_jubjub: this.circuits.withdraw_shielded_to_contract_with_grant_jubjub,
      issue_grant_with_k256: this.circuits.issue_grant_with_k256,
      revoke_grant_with_k256: this.circuits.revoke_grant_with_k256,
      revoke_all_grants_with_k256: this.circuits.revoke_all_grants_with_k256,
      issue_grant_with_jubjub: this.circuits.issue_grant_with_jubjub,
      revoke_grant_with_jubjub: this.circuits.revoke_grant_with_jubjub,
      revoke_all_grants_with_jubjub: this.circuits.revoke_all_grants_with_jubjub
    };
  }
  async initialState(...args_0) {
    if (args_0.length !== 3) {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 3 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const constructorContext_0 = args_0[0];
    const initial_device_boot_0 = args_0[1];
    const encryption_key_0 = args_0[2];
    if (typeof(constructorContext_0) !== 'object') {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'constructorContext' in argument 1 (as invoked from Typescript) to be an object`);
    }
    if (!('initialPrivateState' in constructorContext_0)) {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'initialPrivateState' in argument 1 (as invoked from Typescript)`);
    }
    if (!('initialZswapLocalState' in constructorContext_0)) {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'initialZswapLocalState' in argument 1 (as invoked from Typescript)`);
    }
    if (typeof(constructorContext_0.initialZswapLocalState) !== 'object') {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'initialZswapLocalState' in argument 1 (as invoked from Typescript) to be an object`);
    }
    if (!(initial_device_boot_0.buffer instanceof ArrayBuffer && initial_device_boot_0.BYTES_PER_ELEMENT === 1 && initial_device_boot_0.length === 32)) {
      __compactRuntime.typeError('Contract state constructor',
                                 'argument 1 (argument 2 as invoked from Typescript)',
                                 'account.compact line 291 char 1',
                                 'Bytes<32>',
                                 initial_device_boot_0)
    }
    if (!(encryption_key_0.buffer instanceof ArrayBuffer && encryption_key_0.BYTES_PER_ELEMENT === 1 && encryption_key_0.length === 32)) {
      __compactRuntime.typeError('Contract state constructor',
                                 'argument 2 (argument 3 as invoked from Typescript)',
                                 'account.compact line 291 char 1',
                                 'Bytes<32>',
                                 encryption_key_0)
    }
    const state_0 = new __compactRuntime.ContractState();
    let stateValue_0 = __compactRuntime.StateValue.newArray();
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    state_0.data = new __compactRuntime.ChargedState(stateValue_0);
    state_0.setOperation('activate_initial_device_with_jubjub', new __compactRuntime.ContractOperation());
    state_0.setOperation('activate_initial_device_with_k256', new __compactRuntime.ContractOperation());
    state_0.setOperation('deposit_unshielded', new __compactRuntime.ContractOperation());
    state_0.setOperation('withdraw_unshielded_with_jubjub', new __compactRuntime.ContractOperation());
    state_0.setOperation('withdraw_unshielded_with_k256', new __compactRuntime.ContractOperation());
    state_0.setOperation('deposit_shielded', new __compactRuntime.ContractOperation());
    state_0.setOperation('append_inbox_with_jubjub', new __compactRuntime.ContractOperation());
    state_0.setOperation('append_inbox_with_k256', new __compactRuntime.ContractOperation());
    state_0.setOperation('withdraw_shielded_with_jubjub', new __compactRuntime.ContractOperation());
    state_0.setOperation('withdraw_shielded_with_k256', new __compactRuntime.ContractOperation());
    state_0.setOperation('withdraw_shielded_to_contract_with_jubjub', new __compactRuntime.ContractOperation());
    state_0.setOperation('withdraw_shielded_to_contract_with_k256', new __compactRuntime.ContractOperation());
    state_0.setOperation('rotate_enc_key_with_jubjub', new __compactRuntime.ContractOperation());
    state_0.setOperation('rotate_enc_key_with_k256', new __compactRuntime.ContractOperation());
    state_0.setOperation('add_device_with_jubjub', new __compactRuntime.ContractOperation());
    state_0.setOperation('add_device_with_k256', new __compactRuntime.ContractOperation());
    state_0.setOperation('remove_device_with_jubjub', new __compactRuntime.ContractOperation());
    state_0.setOperation('remove_device_with_k256', new __compactRuntime.ContractOperation());
    state_0.setOperation('withdraw_unshielded_with_grant_k256', new __compactRuntime.ContractOperation());
    state_0.setOperation('withdraw_shielded_with_grant_k256', new __compactRuntime.ContractOperation());
    state_0.setOperation('withdraw_shielded_to_contract_with_grant_k256', new __compactRuntime.ContractOperation());
    state_0.setOperation('withdraw_unshielded_with_grant_jubjub', new __compactRuntime.ContractOperation());
    state_0.setOperation('withdraw_shielded_with_grant_jubjub', new __compactRuntime.ContractOperation());
    state_0.setOperation('withdraw_shielded_to_contract_with_grant_jubjub', new __compactRuntime.ContractOperation());
    state_0.setOperation('issue_grant_with_k256', new __compactRuntime.ContractOperation());
    state_0.setOperation('revoke_grant_with_k256', new __compactRuntime.ContractOperation());
    state_0.setOperation('revoke_all_grants_with_k256', new __compactRuntime.ContractOperation());
    state_0.setOperation('issue_grant_with_jubjub', new __compactRuntime.ContractOperation());
    state_0.setOperation('revoke_grant_with_jubjub', new __compactRuntime.ContractOperation());
    state_0.setOperation('revoke_all_grants_with_jubjub', new __compactRuntime.ContractOperation());
    const context = __compactRuntime.createCircuitContext('constructor', __compactRuntime.dummyContractAddress(), constructorContext_0.initialZswapLocalState.coinPublicKey, state_0.data, constructorContext_0.initialPrivateState);
    const partialProofData = {
      input: { value: [], alignment: [] },
      output: undefined,
      publicTranscript: [],
      privateTranscriptOutputs: []
    };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(0n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(0n),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(1n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(new Uint8Array(32)),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(2n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newMap(
                                                          new __compactRuntime.StateMap()
                                                        ).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(3n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(0n),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(4n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newMap(
                                                          new __compactRuntime.StateMap()
                                                        ).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(5n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_11.toValue(0n),
                                                                                              alignment: _descriptor_11.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(6n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newMap(
                                                          new __compactRuntime.StateMap()
                                                        ).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(7n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_11.toValue(0n),
                                                                                              alignment: _descriptor_11.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(8n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(0n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(9n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(0n),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(10n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(new Uint8Array(32)),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(11n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_9.toValue(false),
                                                                                              alignment: _descriptor_9.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(12n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newMap(
                                                          new __compactRuntime.StateMap()
                                                        ).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(13n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_11.toValue(0n),
                                                                                              alignment: _descriptor_11.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_0 = 0n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(0n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(tmp_0),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(1n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(encryption_key_0),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_1 = 0n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(3n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(tmp_1),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_2 = 2n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(5n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_11.toValue(tmp_2),
                                                                                              alignment: _descriptor_11.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(10n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(initial_device_boot_0),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(11n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_9.toValue(false),
                                                                                              alignment: _descriptor_9.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_3 = 0n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(7n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_11.toValue(tmp_3),
                                                                                              alignment: _descriptor_11.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_4 = 0n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(8n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(tmp_4),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_5 = 0n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(9n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(tmp_5),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_6 = 0n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(13n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_11.toValue(tmp_6),
                                                                                              alignment: _descriptor_11.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    state_0.data = new __compactRuntime.ChargedState(context.callContext.currentQueryContext.state.state);
    return {
      currentContractState: state_0,
      currentPrivateState: context.callContext.currentPrivateState,
      currentZswapLocalState: context.callContext.currentZswapLocalState
    }
  }
  _some_0(value_0) { return { is_some: true, value: value_0 }; }
  _none_0() {
    return { is_some: false,
             value:
               { nonce: new Uint8Array(32), color: new Uint8Array(32), value: 0n } };
  }
  _left_0(value_0) {
    return { is_left: true, left: value_0, right: new Uint8Array(32) };
  }
  _left_1(value_0) {
    return { is_left: true, left: value_0, right: { bytes: new Uint8Array(32) } };
  }
  _right_0(value_0) {
    return { is_left: false, left: { bytes: new Uint8Array(32) }, right: value_0 };
  }
  _right_1(value_0) {
    return { is_left: false, left: { bytes: new Uint8Array(32) }, right: value_0 };
  }
  async _receiveShielded_0(context, partialProofData, coin_0) {
    const recipient_0 = this._right_1(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                partialProofData,
                                                                                                [
                                                                                                 { dup: { n: 2 } },
                                                                                                 { idx: { cached: true,
                                                                                                          pushPath: false,
                                                                                                          path: [
                                                                                                                 { tag: 'value',
                                                                                                                   value: { value: _descriptor_8.toValue(0n),
                                                                                                                            alignment: _descriptor_8.alignment() } }] } },
                                                                                                 { popeq: { cached: true,
                                                                                                            result: undefined } }]).value));
    this._createZswapOutput_0(context, partialProofData, coin_0, recipient_0);
    const tmp_0 = this._coinCommitment_0(coin_0, recipient_0);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { swap: { n: 0 } },
                                       { idx: { cached: true,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_8.toValue(1n),
                                                                  alignment: _descriptor_8.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(tmp_0),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newNull().encode() } },
                                       { ins: { cached: true, n: 2 } },
                                       { swap: { n: 0 } }]);
    return [];
  }
  async _sendShielded_0(context, partialProofData, input_0, recipient_0, value_0)
  {
    const selfAddr_0 = _descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                 partialProofData,
                                                                                 [
                                                                                  { dup: { n: 2 } },
                                                                                  { idx: { cached: true,
                                                                                           pushPath: false,
                                                                                           path: [
                                                                                                  { tag: 'value',
                                                                                                    value: { value: _descriptor_8.toValue(0n),
                                                                                                             alignment: _descriptor_8.alignment() } }] } },
                                                                                  { popeq: { cached: true,
                                                                                             result: undefined } }]).value);
    this._createZswapInput_0(context, partialProofData, input_0);
    const tmp_0 = this._coinNullifier_0(this._downcastQualifiedCoin_0(input_0),
                                        selfAddr_0);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { swap: { n: 0 } },
                                       { idx: { cached: true,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_8.toValue(0n),
                                                                  alignment: _descriptor_8.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(tmp_0),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newNull().encode() } },
                                       { ins: { cached: true, n: 2 } },
                                       { swap: { n: 0 } }]);
    let t_0;
    const change_0 = (t_0 = input_0.value,
                      (__compactRuntime.assert(t_0 >= value_0,
                                               'result of subtraction would be negative'),
                       t_0 - value_0));
    const output_0 = { nonce:
                         this._upgradeFromTransient_0(this._transientHash_0([__compactRuntime.convertBytesToUint(52435875175126190479447740508185965837690552500527637822603658699938581184512n,
                                                                                                                 28,
                                                                                                                 new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 107, 101, 114, 110, 101, 108, 58, 110, 111, 110, 99, 101, 95, 101, 118, 111, 108, 118, 101]),
                                                                                                                 'Field',
                                                                                                                 '<standard library>'),
                                                                             this._degradeToTransient_0(input_0.nonce)])),
                       color: input_0.color,
                       value: value_0 };
    this._createZswapOutput_0(context, partialProofData, output_0, recipient_0);
    const tmp_1 = this._coinCommitment_0(output_0, recipient_0);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { swap: { n: 0 } },
                                       { idx: { cached: true,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_8.toValue(2n),
                                                                  alignment: _descriptor_8.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(tmp_1),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newNull().encode() } },
                                       { ins: { cached: true, n: 2 } },
                                       { swap: { n: 0 } }]);
    if (!recipient_0.is_left
        &&
        this._equal_0(recipient_0.right.bytes, selfAddr_0.bytes))
    {
      const tmp_2 = this._coinCommitment_0(output_0, recipient_0);
      __compactRuntime.queryLedgerState(context,
                                        partialProofData,
                                        [
                                         { swap: { n: 0 } },
                                         { idx: { cached: true,
                                                  pushPath: true,
                                                  path: [
                                                         { tag: 'value',
                                                           value: { value: _descriptor_8.toValue(1n),
                                                                    alignment: _descriptor_8.alignment() } }] } },
                                         { push: { storage: false,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(tmp_2),
                                                                                                alignment: _descriptor_1.alignment() }).encode() } },
                                         { push: { storage: false,
                                                   value: __compactRuntime.StateValue.newNull().encode() } },
                                         { ins: { cached: true, n: 2 } },
                                         { swap: { n: 0 } }]);
    }
    if (change_0 === 0n) {
      return { change: this._none_0(), sent: output_0 };
    } else {
      const changeCoin_0 = { nonce:
                               this._upgradeFromTransient_0(this._transientHash_0([__compactRuntime.convertBytesToUint(52435875175126190479447740508185965837690552500527637822603658699938581184512n,
                                                                                                                       30,
                                                                                                                       new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 107, 101, 114, 110, 101, 108, 58, 110, 111, 110, 99, 101, 95, 101, 118, 111, 108, 118, 101, 47, 50]),
                                                                                                                       'Field',
                                                                                                                       '<standard library>'),
                                                                                   this._degradeToTransient_0(input_0.nonce)])),
                             color: input_0.color,
                             value: change_0 };
      this._createZswapOutput_0(context,
                                partialProofData,
                                changeCoin_0,
                                this._right_1(selfAddr_0));
      const cm_0 = this._coinCommitment_0(changeCoin_0,
                                          this._right_1(selfAddr_0));
      __compactRuntime.queryLedgerState(context,
                                        partialProofData,
                                        [
                                         { swap: { n: 0 } },
                                         { idx: { cached: true,
                                                  pushPath: true,
                                                  path: [
                                                         { tag: 'value',
                                                           value: { value: _descriptor_8.toValue(2n),
                                                                    alignment: _descriptor_8.alignment() } }] } },
                                         { push: { storage: false,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(cm_0),
                                                                                                alignment: _descriptor_1.alignment() }).encode() } },
                                         { push: { storage: false,
                                                   value: __compactRuntime.StateValue.newNull().encode() } },
                                         { ins: { cached: true, n: 2 } },
                                         { swap: { n: 0 } }]);
      __compactRuntime.queryLedgerState(context,
                                        partialProofData,
                                        [
                                         { swap: { n: 0 } },
                                         { idx: { cached: true,
                                                  pushPath: true,
                                                  path: [
                                                         { tag: 'value',
                                                           value: { value: _descriptor_8.toValue(1n),
                                                                    alignment: _descriptor_8.alignment() } }] } },
                                         { push: { storage: false,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(cm_0),
                                                                                                alignment: _descriptor_1.alignment() }).encode() } },
                                         { push: { storage: false,
                                                   value: __compactRuntime.StateValue.newNull().encode() } },
                                         { ins: { cached: true, n: 2 } },
                                         { swap: { n: 0 } }]);
      return { change: this._some_0(changeCoin_0), sent: output_0 };
    }
  }
  _downcastQualifiedCoin_0(coin_0) {
    return { nonce: coin_0.nonce, color: coin_0.color, value: coin_0.value };
  }
  _coinCommitment_0(coin_0, recipient_0) {
    return this._persistentHash_33({ domain_sep:
                                       new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 122, 115, 119, 97, 112, 45, 99, 99, 91, 118, 49, 93]),
                                     info: coin_0,
                                     dataType: recipient_0.is_left,
                                     data:
                                       recipient_0.is_left ?
                                       recipient_0.left.bytes :
                                       recipient_0.right.bytes });
  }
  _coinNullifier_0(coin_0, addr_0) {
    return this._persistentHash_33({ domain_sep:
                                       new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 122, 115, 119, 97, 112, 45, 99, 110, 91, 118, 49, 93]),
                                     info: coin_0,
                                     dataType: false,
                                     data: addr_0.bytes });
  }
  async _sendUnshielded_0(context,
                          partialProofData,
                          color_0,
                          amount_0,
                          recipient_0)
  {
    const tmp_0 = this._left_0(color_0);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { swap: { n: 0 } },
                                       { idx: { cached: true,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_8.toValue(7n),
                                                                  alignment: _descriptor_8.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_62.toValue(tmp_0),
                                                                                              alignment: _descriptor_62.alignment() }).encode() } },
                                       { dup: { n: 1 } },
                                       { dup: { n: 1 } },
                                       'member',
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_10.toValue(amount_0),
                                                                                              alignment: _descriptor_10.alignment() }).encode() } },
                                       { swap: { n: 0 } },
                                       'neg',
                                       { branch: { skip: 4 } },
                                       { dup: { n: 2 } },
                                       { dup: { n: 2 } },
                                       { idx: { cached: true,
                                                pushPath: false,
                                                path: [ { tag: 'stack' }] } },
                                       'add',
                                       { ins: { cached: true, n: 2 } },
                                       { swap: { n: 0 } }]);
    const tmp_1 = this._left_0(color_0);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { swap: { n: 0 } },
                                       { idx: { cached: true,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_8.toValue(8n),
                                                                  alignment: _descriptor_8.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell(__compactRuntime.alignedConcat(
                                                                                              { value: _descriptor_62.toValue(tmp_1),
                                                                                                alignment: _descriptor_62.alignment() },
                                                                                              { value: _descriptor_63.toValue(recipient_0),
                                                                                                alignment: _descriptor_63.alignment() }
                                                                                            )).encode() } },
                                       { dup: { n: 1 } },
                                       { dup: { n: 1 } },
                                       'member',
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_10.toValue(amount_0),
                                                                                              alignment: _descriptor_10.alignment() }).encode() } },
                                       { swap: { n: 0 } },
                                       'neg',
                                       { branch: { skip: 4 } },
                                       { dup: { n: 2 } },
                                       { dup: { n: 2 } },
                                       { idx: { cached: true,
                                                pushPath: false,
                                                path: [ { tag: 'stack' }] } },
                                       'add',
                                       { ins: { cached: true, n: 2 } },
                                       { swap: { n: 0 } }]);
    if (recipient_0.is_left
        &&
        this._equal_1(recipient_0.left.bytes,
                      _descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                partialProofData,
                                                                                [
                                                                                 { dup: { n: 2 } },
                                                                                 { idx: { cached: true,
                                                                                          pushPath: false,
                                                                                          path: [
                                                                                                 { tag: 'value',
                                                                                                   value: { value: _descriptor_8.toValue(0n),
                                                                                                            alignment: _descriptor_8.alignment() } }] } },
                                                                                 { popeq: { cached: true,
                                                                                            result: undefined } }]).value).bytes))
    {
      const tmp_2 = this._left_0(color_0);
      __compactRuntime.queryLedgerState(context,
                                        partialProofData,
                                        [
                                         { swap: { n: 0 } },
                                         { idx: { cached: true,
                                                  pushPath: true,
                                                  path: [
                                                         { tag: 'value',
                                                           value: { value: _descriptor_8.toValue(6n),
                                                                    alignment: _descriptor_8.alignment() } }] } },
                                         { push: { storage: false,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_62.toValue(tmp_2),
                                                                                                alignment: _descriptor_62.alignment() }).encode() } },
                                         { dup: { n: 1 } },
                                         { dup: { n: 1 } },
                                         'member',
                                         { push: { storage: false,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_10.toValue(amount_0),
                                                                                                alignment: _descriptor_10.alignment() }).encode() } },
                                         { swap: { n: 0 } },
                                         'neg',
                                         { branch: { skip: 4 } },
                                         { dup: { n: 2 } },
                                         { dup: { n: 2 } },
                                         { idx: { cached: true,
                                                  pushPath: false,
                                                  path: [ { tag: 'stack' }] } },
                                         'add',
                                         { ins: { cached: true, n: 2 } },
                                         { swap: { n: 0 } }]);
    }
    return [];
  }
  async _receiveUnshielded_0(context, partialProofData, color_0, amount_0) {
    const tmp_0 = this._left_0(color_0);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { swap: { n: 0 } },
                                       { idx: { cached: true,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_8.toValue(6n),
                                                                  alignment: _descriptor_8.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_62.toValue(tmp_0),
                                                                                              alignment: _descriptor_62.alignment() }).encode() } },
                                       { dup: { n: 1 } },
                                       { dup: { n: 1 } },
                                       'member',
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_10.toValue(amount_0),
                                                                                              alignment: _descriptor_10.alignment() }).encode() } },
                                       { swap: { n: 0 } },
                                       'neg',
                                       { branch: { skip: 4 } },
                                       { dup: { n: 2 } },
                                       { dup: { n: 2 } },
                                       { idx: { cached: true,
                                                pushPath: false,
                                                path: [ { tag: 'stack' }] } },
                                       'add',
                                       { ins: { cached: true, n: 2 } },
                                       { swap: { n: 0 } }]);
    return [];
  }
  _hashToSecp256k1Scalar_0(digest_0) {
    const v_0 = Array.from(digest_0, BigInt);
    const beReversed_0 = Uint8Array.from([v_0[31],
                                          v_0[30],
                                          v_0[29],
                                          v_0[28],
                                          v_0[27],
                                          v_0[26],
                                          v_0[25],
                                          v_0[24],
                                          v_0[23],
                                          v_0[22],
                                          v_0[21],
                                          v_0[20],
                                          v_0[19],
                                          v_0[18],
                                          v_0[17],
                                          v_0[16],
                                          v_0[15],
                                          v_0[14],
                                          v_0[13],
                                          v_0[12],
                                          v_0[11],
                                          v_0[10],
                                          v_0[9],
                                          v_0[8],
                                          v_0[7],
                                          v_0[6],
                                          v_0[5],
                                          v_0[4],
                                          v_0[3],
                                          v_0[2],
                                          v_0[1],
                                          v_0[0]],
                                         Number);
    return __compactRuntime.convertBytesToField(115792089237316195423570985008687907852837564279074904382605163141518161494336n,
                                                32,
                                                beReversed_0,
                                                'Secp256k1Scalar',
                                                '<standard library>');
  }
  _secp256k1EcdsaVerify_0(msgHash_0, sig_0, pk_0) {
    const z_0 = this._hashToSecp256k1Scalar_0(msgHash_0);
    const __compact_pattern_tmp1_0 = sig_0;
    const r_0 = __compact_pattern_tmp1_0.r;
    const s_0 = __compact_pattern_tmp1_0.s;
    const w_0 = this._inv_0(s_0);
    const u1_0 = __compactRuntime.secp256k1ScalarMul(z_0, w_0);
    const u2_0 = __compactRuntime.secp256k1ScalarMul(r_0, w_0);
    const point_0 = this._ecAdd_1(this._ecMulGenerator_1(u1_0),
                                  this._ecMul_1(pk_0, u2_0));
    return __compactRuntime.convertBytesToField(115792089237316195423570985008687907852837564279074904382605163141518161494336n,
                                                32,
                                                __compactRuntime.convertBigintToBytes(32,
                                                                                      this._secp256k1PointX_0(point_0),
                                                                                      '<standard library>'),
                                                'Secp256k1Scalar',
                                                '<standard library>')
           ===
           r_0;
  }
  _transientHash_0(value_0) {
    const result_0 = __compactRuntime.transientHash(_descriptor_61, value_0);
    return result_0;
  }
  _persistentHash_0(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_59, value_0);
    return result_0;
  }
  _persistentHash_1(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_60, value_0);
    return result_0;
  }
  _persistentHash_2(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_57, value_0);
    return result_0;
  }
  _persistentHash_3(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_58, value_0);
    return result_0;
  }
  _persistentHash_4(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_1, value_0);
    return result_0;
  }
  _persistentHash_5(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_56, value_0);
    return result_0;
  }
  _persistentHash_6(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_53, value_0);
    return result_0;
  }
  _persistentHash_7(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_54, value_0);
    return result_0;
  }
  _persistentHash_8(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_51, value_0);
    return result_0;
  }
  _persistentHash_9(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_52, value_0);
    return result_0;
  }
  _persistentHash_10(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_49, value_0);
    return result_0;
  }
  _persistentHash_11(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_50, value_0);
    return result_0;
  }
  _persistentHash_12(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_47, value_0);
    return result_0;
  }
  _persistentHash_13(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_48, value_0);
    return result_0;
  }
  _persistentHash_14(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_45, value_0);
    return result_0;
  }
  _persistentHash_15(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_46, value_0);
    return result_0;
  }
  _persistentHash_16(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_43, value_0);
    return result_0;
  }
  _persistentHash_17(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_44, value_0);
    return result_0;
  }
  _persistentHash_18(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_41, value_0);
    return result_0;
  }
  _persistentHash_19(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_42, value_0);
    return result_0;
  }
  _persistentHash_20(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_39, value_0);
    return result_0;
  }
  _persistentHash_21(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_40, value_0);
    return result_0;
  }
  _persistentHash_22(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_37, value_0);
    return result_0;
  }
  _persistentHash_23(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_38, value_0);
    return result_0;
  }
  _persistentHash_24(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_35, value_0);
    return result_0;
  }
  _persistentHash_25(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_36, value_0);
    return result_0;
  }
  _persistentHash_26(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_33, value_0);
    return result_0;
  }
  _persistentHash_27(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_34, value_0);
    return result_0;
  }
  _persistentHash_28(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_31, value_0);
    return result_0;
  }
  _persistentHash_29(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_32, value_0);
    return result_0;
  }
  _persistentHash_30(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_28, value_0);
    return result_0;
  }
  _persistentHash_31(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_30, value_0);
    return result_0;
  }
  _persistentHash_32(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_25, value_0);
    return result_0;
  }
  _persistentHash_33(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_27, value_0);
    return result_0;
  }
  _degradeToTransient_0(x_0) {
    const result_0 = __compactRuntime.degradeToTransient(x_0);
    return result_0;
  }
  _upgradeFromTransient_0(x_0) {
    const result_0 = __compactRuntime.upgradeFromTransient(x_0);
    return result_0;
  }
  _ecAdd_0(a_0, b_0) {
    const result_0 = __compactRuntime.ecAdd(a_0, b_0);
    return result_0;
  }
  _ecMul_0(a_0, b_0) {
    const result_0 = __compactRuntime.ecMul(a_0, b_0);
    return result_0;
  }
  _ecMulGenerator_0(b_0) {
    const result_0 = __compactRuntime.ecMulGenerator(b_0);
    return result_0;
  }
  _createZswapInput_0(context, partialProofData, coin_0) {
    const result_0 = __compactRuntime.createZswapInput(context, coin_0);
    partialProofData.privateTranscriptOutputs.push({
      value: [],
      alignment: []
    });
    return result_0;
  }
  _createZswapOutput_0(context, partialProofData, coin_0, recipient_0) {
    const result_0 = __compactRuntime.createZswapOutput(context,
                                                        coin_0,
                                                        recipient_0);
    partialProofData.privateTranscriptOutputs.push({
      value: [],
      alignment: []
    });
    return result_0;
  }
  _inv_0(s_0) {
    const result_0 = __compactRuntime.secp256k1ScalarInv(s_0);
    return result_0;
  }
  _secp256k1PointX_0(pt_0) {
    const result_0 = __compactRuntime.secp256k1PointX(pt_0);
    return result_0;
  }
  _secp256k1PointY_0(pt_0) {
    const result_0 = __compactRuntime.secp256k1PointY(pt_0);
    return result_0;
  }
  _ecAdd_1(a_0, b_0) {
    const result_0 = __compactRuntime.secp256k1Add(a_0, b_0);
    return result_0;
  }
  _ecMul_1(a_0, b_0) {
    const result_0 = __compactRuntime.secp256k1Mul(a_0, b_0);
    return result_0;
  }
  _ecMulGenerator_1(b_0) {
    const result_0 = __compactRuntime.secp256k1MulGenerator(b_0);
    return result_0;
  }
  _held_coin_0(context, partialProofData, color_0) {
    const witnessContext_0 = __compactRuntime.createWitnessContext(ledger(context.callContext.currentQueryContext.state), context.callContext.currentPrivateState, context.callContext.currentQueryContext.address);
    const [nextPrivateState_0, result_0] = this.witnesses.held_coin(witnessContext_0,
                                                                    color_0);
    context.callContext.currentPrivateState = nextPrivateState_0;
    if (!(typeof(result_0) === 'object' && result_0.nonce.buffer instanceof ArrayBuffer && result_0.nonce.BYTES_PER_ELEMENT === 1 && result_0.nonce.length === 32 && result_0.color.buffer instanceof ArrayBuffer && result_0.color.BYTES_PER_ELEMENT === 1 && result_0.color.length === 32 && typeof(result_0.value) === 'bigint' && result_0.value >= 0n && result_0.value <= 340282366920938463463374607431768211455n && typeof(result_0.mt_index) === 'bigint' && result_0.mt_index >= 0n && result_0.mt_index <= 18446744073709551615n)) {
      __compactRuntime.typeError('held_coin',
                                 'return value',
                                 'account.compact line 171 char 1',
                                 'struct QualifiedShieldedCoinInfo<nonce: Bytes<32>, color: Bytes<32>, value: Uint<0..340282366920938463463374607431768211456>, mt_index: Uint<0..18446744073709551616>>',
                                 result_0)
    }
    partialProofData.privateTranscriptOutputs.push({
      value: _descriptor_21.toValue(result_0),
      alignment: _descriptor_21.alignment()
    });
    return result_0;
  }
  async _do_activate_initial_device_0(context, partialProofData, entry_0) {
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_8.toValue(6n),
                                                                  alignment: _descriptor_8.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(entry_0),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newNull().encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    const tmp_0 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(8n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(tmp_0),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(11n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_9.toValue(true),
                                                                                              alignment: _descriptor_9.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(10n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    await this._bump_round_0(context, partialProofData);
    return [];
  }
  async _activate_initial_device_with_jubjub_0(context,
                                               partialProofData,
                                               pk_0,
                                               salt_0)
  {
    __compactRuntime.assert(!_descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_8.toValue(11n),
                                                                                                                   alignment: _descriptor_8.alignment() } }] } },
                                                                                        { popeq: { cached: false,
                                                                                                   result: undefined } }]).value),
                            'already activated');
    __compactRuntime.assert(!this._equal_2(this._ecMul_0(pk_0,
                                                         __compactRuntime.convertNumericToJubjubScalar(8n)),
                                           this._ecMulGenerator_0(__compactRuntime.convertNumericToJubjubScalar(0n))),
                            'device key has small order');
    __compactRuntime.assert(this._equal_3(this._derive_boot_commitment_with_jubjub_0(salt_0,
                                                                                     pk_0),
                                          _descriptor_1.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                    partialProofData,
                                                                                                    [
                                                                                                     { dup: { n: 0 } },
                                                                                                     { idx: { cached: false,
                                                                                                              pushPath: false,
                                                                                                              path: [
                                                                                                                     { tag: 'value',
                                                                                                                       value: { value: _descriptor_8.toValue(10n),
                                                                                                                                alignment: _descriptor_8.alignment() } }] } },
                                                                                                     { popeq: { cached: false,
                                                                                                                result: undefined } }]).value)),
                            'boot commitment mismatch');
    await this._do_activate_initial_device_0(context,
                                             partialProofData,
                                             this._derive_device_entry_with_jubjub_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                               partialProofData,
                                                                                                                                               [
                                                                                                                                                { dup: { n: 2 } },
                                                                                                                                                { idx: { cached: true,
                                                                                                                                                         pushPath: false,
                                                                                                                                                         path: [
                                                                                                                                                                { tag: 'value',
                                                                                                                                                                  value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                                           alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                                { popeq: { cached: true,
                                                                                                                                                           result: undefined } }]).value),
                                                                                     pk_0,
                                                                                     _descriptor_11.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                                partialProofData,
                                                                                                                                                [
                                                                                                                                                 { dup: { n: 0 } },
                                                                                                                                                 { idx: { cached: false,
                                                                                                                                                          pushPath: false,
                                                                                                                                                          path: [
                                                                                                                                                                 { tag: 'value',
                                                                                                                                                                   value: { value: _descriptor_8.toValue(7n),
                                                                                                                                                                            alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                                 { popeq: { cached: false,
                                                                                                                                                            result: undefined } }]).value),
                                                                                     0n));
    return [];
  }
  async _activate_initial_device_with_k256_0(context,
                                             partialProofData,
                                             pk_0,
                                             salt_0,
                                             envelope_0)
  {
    __compactRuntime.assert(!_descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_8.toValue(11n),
                                                                                                                   alignment: _descriptor_8.alignment() } }] } },
                                                                                        { popeq: { cached: false,
                                                                                                   result: undefined } }]).value),
                            'already activated');
    this._require_live_k256_key_0(pk_0);
    __compactRuntime.assert(this._equal_4(this._derive_boot_commitment_with_k256_0(salt_0,
                                                                                   pk_0,
                                                                                   envelope_0),
                                          _descriptor_1.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                    partialProofData,
                                                                                                    [
                                                                                                     { dup: { n: 0 } },
                                                                                                     { idx: { cached: false,
                                                                                                              pushPath: false,
                                                                                                              path: [
                                                                                                                     { tag: 'value',
                                                                                                                       value: { value: _descriptor_8.toValue(10n),
                                                                                                                                alignment: _descriptor_8.alignment() } }] } },
                                                                                                     { popeq: { cached: false,
                                                                                                                result: undefined } }]).value)),
                            'boot commitment mismatch');
    await this._do_activate_initial_device_0(context,
                                             partialProofData,
                                             this._derive_device_entry_with_k256_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                             partialProofData,
                                                                                                                                             [
                                                                                                                                              { dup: { n: 2 } },
                                                                                                                                              { idx: { cached: true,
                                                                                                                                                       pushPath: false,
                                                                                                                                                       path: [
                                                                                                                                                              { tag: 'value',
                                                                                                                                                                value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                                         alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                              { popeq: { cached: true,
                                                                                                                                                         result: undefined } }]).value),
                                                                                   pk_0,
                                                                                   envelope_0,
                                                                                   _descriptor_11.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                              partialProofData,
                                                                                                                                              [
                                                                                                                                               { dup: { n: 0 } },
                                                                                                                                               { idx: { cached: false,
                                                                                                                                                        pushPath: false,
                                                                                                                                                        path: [
                                                                                                                                                               { tag: 'value',
                                                                                                                                                                 value: { value: _descriptor_8.toValue(7n),
                                                                                                                                                                          alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                               { popeq: { cached: false,
                                                                                                                                                          result: undefined } }]).value),
                                                                                   0n));
    return [];
  }
  _derive_boot_commitment_with_jubjub_0(salt_0, pk_0) {
    return this._persistentHash_0([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 98, 111, 111, 116, 58, 118, 49, 0, 0, 0, 0, 0, 0, 0, 0]),
                                   salt_0,
                                   pk_0]);
  }
  _derive_boot_commitment_with_k256_0(salt_0, pk_0, envelope_0) {
    return this._persistentHash_1([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 98, 111, 111, 116, 58, 107, 49, 58, 118, 50, 0, 0, 0, 0, 0]),
                                   salt_0,
                                   __compactRuntime.convertBigintToBytes(32,
                                                                         this._secp256k1PointX_0(pk_0),
                                                                         'account.compact line 367 char 6'),
                                   __compactRuntime.convertBigintToBytes(32,
                                                                         this._secp256k1PointY_0(pk_0),
                                                                         'account.compact line 367 char 40'),
                                   envelope_0]);
  }
  _derive_device_entry_with_jubjub_0(self_addr_0, pk_0, epoch_0, counter_0) {
    return this._persistentHash_2([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 100, 101, 118, 105, 99, 101, 58, 118, 49, 0, 0, 0, 0, 0, 0]),
                                   self_addr_0,
                                   pk_0,
                                   epoch_0,
                                   counter_0]);
  }
  _derive_device_entry_with_k256_0(self_addr_0,
                                   pk_0,
                                   envelope_0,
                                   epoch_0,
                                   counter_0)
  {
    return this._persistentHash_3([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 100, 101, 118, 105, 99, 101, 58, 107, 49, 58, 118, 50, 0, 0, 0]),
                                   self_addr_0,
                                   __compactRuntime.convertBigintToBytes(32,
                                                                         this._secp256k1PointX_0(pk_0),
                                                                         'account.compact line 417 char 6'),
                                   __compactRuntime.convertBigintToBytes(32,
                                                                         this._secp256k1PointY_0(pk_0),
                                                                         'account.compact line 417 char 40'),
                                   envelope_0,
                                   epoch_0,
                                   counter_0]);
  }
  _require_live_k256_key_0(pk_0) {
    __compactRuntime.assert(!(this._equal_5(__compactRuntime.convertBigintToBytes(32,
                                                                                  this._secp256k1PointX_0(pk_0),
                                                                                  'account.compact line 440 char 8'),
                                            new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
                              &&
                              this._equal_6(__compactRuntime.convertBigintToBytes(32,
                                                                                  this._secp256k1PointY_0(pk_0),
                                                                                  'account.compact line 441 char 11'),
                                            new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))),
                            'device key is the point at infinity');
    return [];
  }
  _envelope_digest_0(envelope_0, challenge_0) {
    __compactRuntime.assert(envelope_0 <= 1n, 'unknown envelope');
    const none_0 = this._persistentHash_4(challenge_0);
    const connector_0 = this._persistentHash_5([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 95, 115, 105, 103, 110, 101, 100, 95, 109, 101, 115, 115, 97, 103, 101, 58, 51, 50, 58]),
                                                challenge_0]);
    if (envelope_0 === 1n) { return connector_0; } else { return none_0; }
  }
  _compute_public_point_with_jubjub_0(scalar_0) {
    return this._ecMulGenerator_0(__compactRuntime.convertNumericToJubjubScalar(scalar_0));
  }
  _compute_public_point_with_k256_0(scalar_0) {
    return this._ecMulGenerator_1(scalar_0);
  }
  _challenge_withdraw_unshielded_with_jubjub_0(self_addr_0,
                                               sig_r_0,
                                               pk_0,
                                               color_0,
                                               amount_0,
                                               recipient_0,
                                               nonce_value_0,
                                               grind_nonce_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 97, 117, 116, 104, 58, 118, 49, 58, 119, 105, 116, 104, 100, 114, 97, 119, 95, 117, 110, 115, 104, 105, 101, 108, 100, 101, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_6([dst_0,
                                   self_addr_0,
                                   sig_r_0,
                                   pk_0,
                                   color_0,
                                   amount_0,
                                   recipient_0,
                                   nonce_value_0,
                                   grind_nonce_0]);
  }
  _challenge_withdraw_shielded_with_jubjub_0(self_addr_0,
                                             sig_r_0,
                                             pk_0,
                                             recipient_0,
                                             color_0,
                                             amount_0,
                                             coin_0,
                                             nonce_value_0,
                                             grind_nonce_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 97, 117, 116, 104, 58, 118, 49, 58, 119, 105, 116, 104, 100, 114, 97, 119, 95, 115, 104, 105, 101, 108, 100, 101, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_7([dst_0,
                                   self_addr_0,
                                   sig_r_0,
                                   pk_0,
                                   recipient_0,
                                   color_0,
                                   amount_0,
                                   coin_0,
                                   nonce_value_0,
                                   grind_nonce_0]);
  }
  _challenge_withdraw_shielded_to_contract_with_jubjub_0(self_addr_0,
                                                         sig_r_0,
                                                         pk_0,
                                                         recipient_0,
                                                         color_0,
                                                         amount_0,
                                                         coin_0,
                                                         nonce_value_0,
                                                         grind_nonce_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 97, 117, 116, 104, 58, 118, 49, 58, 119, 105, 116, 104, 100, 114, 97, 119, 95, 115, 104, 105, 101, 108, 100, 101, 100, 95, 116, 111, 95, 99, 111, 110, 116, 114, 97, 99, 116, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_8([dst_0,
                                   self_addr_0,
                                   sig_r_0,
                                   pk_0,
                                   recipient_0,
                                   color_0,
                                   amount_0,
                                   coin_0,
                                   nonce_value_0,
                                   grind_nonce_0]);
  }
  _challenge_append_inbox_with_jubjub_0(self_addr_0,
                                        sig_r_0,
                                        pk_0,
                                        entry_0,
                                        nonce_value_0,
                                        grind_nonce_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 97, 117, 116, 104, 58, 118, 49, 58, 97, 112, 112, 101, 110, 100, 95, 105, 110, 98, 111, 120, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_9([dst_0,
                                   self_addr_0,
                                   sig_r_0,
                                   pk_0,
                                   entry_0,
                                   nonce_value_0,
                                   grind_nonce_0]);
  }
  _challenge_rotate_enc_key_with_jubjub_0(self_addr_0,
                                          sig_r_0,
                                          pk_0,
                                          new_key_0,
                                          nonce_value_0,
                                          grind_nonce_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 97, 117, 116, 104, 58, 118, 49, 58, 114, 111, 116, 97, 116, 101, 95, 101, 110, 99, 95, 107, 101, 121, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_30([dst_0,
                                    self_addr_0,
                                    sig_r_0,
                                    pk_0,
                                    new_key_0,
                                    nonce_value_0,
                                    grind_nonce_0]);
  }
  _challenge_add_device_with_jubjub_0(self_addr_0,
                                      sig_r_0,
                                      pk_0,
                                      new_entry_0,
                                      nonce_value_0,
                                      grind_nonce_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 97, 117, 116, 104, 58, 118, 49, 58, 97, 100, 100, 95, 100, 101, 118, 105, 99, 101, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_30([dst_0,
                                    self_addr_0,
                                    sig_r_0,
                                    pk_0,
                                    new_entry_0,
                                    nonce_value_0,
                                    grind_nonce_0]);
  }
  _challenge_remove_device_with_jubjub_0(self_addr_0,
                                         sig_r_0,
                                         pk_0,
                                         entry_0,
                                         nonce_value_0,
                                         grind_nonce_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 97, 117, 116, 104, 58, 118, 49, 58, 114, 101, 109, 111, 118, 101, 95, 100, 101, 118, 105, 99, 101, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_30([dst_0,
                                    self_addr_0,
                                    sig_r_0,
                                    pk_0,
                                    entry_0,
                                    nonce_value_0,
                                    grind_nonce_0]);
  }
  _challenge_withdraw_unshielded_with_k256_0(self_addr_0,
                                             pk_0,
                                             color_0,
                                             amount_0,
                                             recipient_0,
                                             nonce_value_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 97, 117, 116, 104, 58, 107, 49, 58, 118, 49, 58, 119, 105, 116, 104, 100, 114, 97, 119, 95, 117, 110, 115, 104, 105, 101, 108, 100, 101, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_10([dst_0,
                                    self_addr_0,
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointX_0(pk_0),
                                                                          'account.compact line 641 char 6'),
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointY_0(pk_0),
                                                                          'account.compact line 641 char 40'),
                                    color_0,
                                    amount_0,
                                    recipient_0,
                                    nonce_value_0]);
  }
  _challenge_withdraw_shielded_with_k256_0(self_addr_0,
                                           pk_0,
                                           recipient_0,
                                           color_0,
                                           amount_0,
                                           coin_0,
                                           nonce_value_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 97, 117, 116, 104, 58, 107, 49, 58, 118, 49, 58, 119, 105, 116, 104, 100, 114, 97, 119, 95, 115, 104, 105, 101, 108, 100, 101, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_11([dst_0,
                                    self_addr_0,
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointX_0(pk_0),
                                                                          'account.compact line 660 char 6'),
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointY_0(pk_0),
                                                                          'account.compact line 660 char 40'),
                                    recipient_0,
                                    color_0,
                                    amount_0,
                                    coin_0,
                                    nonce_value_0]);
  }
  _challenge_withdraw_shielded_to_contract_with_k256_0(self_addr_0,
                                                       pk_0,
                                                       recipient_0,
                                                       color_0,
                                                       amount_0,
                                                       coin_0,
                                                       nonce_value_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 97, 117, 116, 104, 58, 107, 49, 58, 118, 49, 58, 119, 105, 116, 104, 100, 114, 97, 119, 95, 115, 104, 105, 101, 108, 100, 101, 100, 95, 116, 111, 95, 99, 111, 110, 116, 114, 97, 99, 116, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_12([dst_0,
                                    self_addr_0,
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointX_0(pk_0),
                                                                          'account.compact line 679 char 6'),
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointY_0(pk_0),
                                                                          'account.compact line 679 char 40'),
                                    recipient_0,
                                    color_0,
                                    amount_0,
                                    coin_0,
                                    nonce_value_0]);
  }
  _challenge_append_inbox_with_k256_0(self_addr_0, pk_0, entry_0, nonce_value_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 97, 117, 116, 104, 58, 107, 49, 58, 118, 49, 58, 97, 112, 112, 101, 110, 100, 95, 105, 110, 98, 111, 120, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_13([dst_0,
                                    self_addr_0,
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointX_0(pk_0),
                                                                          'account.compact line 695 char 6'),
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointY_0(pk_0),
                                                                          'account.compact line 695 char 40'),
                                    entry_0,
                                    nonce_value_0]);
  }
  _challenge_rotate_enc_key_with_k256_0(self_addr_0,
                                        pk_0,
                                        new_key_0,
                                        nonce_value_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 97, 117, 116, 104, 58, 107, 49, 58, 118, 49, 58, 114, 111, 116, 97, 116, 101, 95, 101, 110, 99, 95, 107, 101, 121, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_27([dst_0,
                                    self_addr_0,
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointX_0(pk_0),
                                                                          'account.compact line 711 char 6'),
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointY_0(pk_0),
                                                                          'account.compact line 711 char 40'),
                                    new_key_0,
                                    nonce_value_0]);
  }
  _challenge_add_device_with_k256_0(self_addr_0,
                                    pk_0,
                                    new_entry_0,
                                    nonce_value_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 97, 117, 116, 104, 58, 107, 49, 58, 118, 49, 58, 97, 100, 100, 95, 100, 101, 118, 105, 99, 101, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_27([dst_0,
                                    self_addr_0,
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointX_0(pk_0),
                                                                          'account.compact line 727 char 6'),
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointY_0(pk_0),
                                                                          'account.compact line 727 char 40'),
                                    new_entry_0,
                                    nonce_value_0]);
  }
  _challenge_remove_device_with_k256_0(self_addr_0, pk_0, entry_0, nonce_value_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 97, 117, 116, 104, 58, 107, 49, 58, 118, 49, 58, 114, 101, 109, 111, 118, 101, 95, 100, 101, 118, 105, 99, 101, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_27([dst_0,
                                    self_addr_0,
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointX_0(pk_0),
                                                                          'account.compact line 743 char 6'),
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointY_0(pk_0),
                                                                          'account.compact line 743 char 40'),
                                    entry_0,
                                    nonce_value_0]);
  }
  async _require_authorised_with_jubjub_0(context,
                                          partialProofData,
                                          pk_0,
                                          use_counter_0,
                                          sig_r_0,
                                          sig_s_0,
                                          challenge_0)
  {
    __compactRuntime.assert(!this._equal_7(this._ecMul_0(pk_0,
                                                         __compactRuntime.convertNumericToJubjubScalar(8n)),
                                           this._ecMulGenerator_0(__compactRuntime.convertNumericToJubjubScalar(0n))),
                            'device key has small order');
    const entry_0 = this._derive_device_entry_with_jubjub_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                      partialProofData,
                                                                                                                      [
                                                                                                                       { dup: { n: 2 } },
                                                                                                                       { idx: { cached: true,
                                                                                                                                pushPath: false,
                                                                                                                                path: [
                                                                                                                                       { tag: 'value',
                                                                                                                                         value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                  alignment: _descriptor_8.alignment() } }] } },
                                                                                                                       { popeq: { cached: true,
                                                                                                                                  result: undefined } }]).value),
                                                            pk_0,
                                                            _descriptor_11.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                       partialProofData,
                                                                                                                       [
                                                                                                                        { dup: { n: 0 } },
                                                                                                                        { idx: { cached: false,
                                                                                                                                 pushPath: false,
                                                                                                                                 path: [
                                                                                                                                        { tag: 'value',
                                                                                                                                          value: { value: _descriptor_8.toValue(7n),
                                                                                                                                                   alignment: _descriptor_8.alignment() } }] } },
                                                                                                                        { popeq: { cached: false,
                                                                                                                                   result: undefined } }]).value),
                                                            use_counter_0);
    __compactRuntime.assert(_descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                      partialProofData,
                                                                                      [
                                                                                       { dup: { n: 0 } },
                                                                                       { idx: { cached: false,
                                                                                                pushPath: false,
                                                                                                path: [
                                                                                                       { tag: 'value',
                                                                                                         value: { value: _descriptor_8.toValue(6n),
                                                                                                                  alignment: _descriptor_8.alignment() } }] } },
                                                                                       { push: { storage: false,
                                                                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(entry_0),
                                                                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                                                                       'member',
                                                                                       { popeq: { cached: true,
                                                                                                  result: undefined } }]).value),
                            'unknown device entry');
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_8.toValue(6n),
                                                                  alignment: _descriptor_8.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(entry_0),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { rem: { cached: false } },
                                       { ins: { cached: true, n: 1 } }]);
    const tmp_0 = this._derive_device_entry_with_jubjub_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                    partialProofData,
                                                                                                                    [
                                                                                                                     { dup: { n: 2 } },
                                                                                                                     { idx: { cached: true,
                                                                                                                              pushPath: false,
                                                                                                                              path: [
                                                                                                                                     { tag: 'value',
                                                                                                                                       value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                alignment: _descriptor_8.alignment() } }] } },
                                                                                                                     { popeq: { cached: true,
                                                                                                                                result: undefined } }]).value),
                                                          pk_0,
                                                          _descriptor_11.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                     partialProofData,
                                                                                                                     [
                                                                                                                      { dup: { n: 0 } },
                                                                                                                      { idx: { cached: false,
                                                                                                                               pushPath: false,
                                                                                                                               path: [
                                                                                                                                      { tag: 'value',
                                                                                                                                        value: { value: _descriptor_8.toValue(7n),
                                                                                                                                                 alignment: _descriptor_8.alignment() } }] } },
                                                                                                                      { popeq: { cached: false,
                                                                                                                                 result: undefined } }]).value),
                                                          ((t1) => {
                                                            if (t1 > 18446744073709551615n) {
                                                              throw new __compactRuntime.CompactError('account.compact line 783 char 39: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                                                            }
                                                            return t1;
                                                          })(use_counter_0 + 1n));
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_8.toValue(6n),
                                                                  alignment: _descriptor_8.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(tmp_0),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newNull().encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    const c_0 = __compactRuntime.convertBytesToUint(52435875175126190479447740508185965837690552500527637822603658699938581184512n,
                                                    32,
                                                    challenge_0,
                                                    'Field',
                                                    'account.compact line 788 char 13');
    __compactRuntime.assert(this._equal_8(this._ecMulGenerator_0(__compactRuntime.convertNumericToJubjubScalar(sig_s_0)),
                                          this._ecAdd_0(sig_r_0,
                                                        this._ecMul_0(pk_0,
                                                                      __compactRuntime.convertNumericToJubjubScalar(c_0)))),
                            'invalid signature');
    const tmp_1 = ((t1) => {
                    if (t1 > 18446744073709551615n) {
                      throw new __compactRuntime.CompactError('account.compact line 793 char 17: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                    }
                    return t1;
                  })(_descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                               partialProofData,
                                                                               [
                                                                                { dup: { n: 0 } },
                                                                                { idx: { cached: false,
                                                                                         pushPath: false,
                                                                                         path: [
                                                                                                { tag: 'value',
                                                                                                  value: { value: _descriptor_8.toValue(9n),
                                                                                                           alignment: _descriptor_8.alignment() } }] } },
                                                                                { popeq: { cached: false,
                                                                                           result: undefined } }]).value)
                     +
                     1n);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(9n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(tmp_1),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    await this._bump_round_0(context, partialProofData);
    return [];
  }
  async _require_authorised_with_k256_0(context,
                                        partialProofData,
                                        pk_0,
                                        use_counter_0,
                                        sig_0,
                                        challenge_0,
                                        envelope_0)
  {
    this._require_live_k256_key_0(pk_0);
    const entry_0 = this._derive_device_entry_with_k256_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                    partialProofData,
                                                                                                                    [
                                                                                                                     { dup: { n: 2 } },
                                                                                                                     { idx: { cached: true,
                                                                                                                              pushPath: false,
                                                                                                                              path: [
                                                                                                                                     { tag: 'value',
                                                                                                                                       value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                alignment: _descriptor_8.alignment() } }] } },
                                                                                                                     { popeq: { cached: true,
                                                                                                                                result: undefined } }]).value),
                                                          pk_0,
                                                          envelope_0,
                                                          _descriptor_11.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                     partialProofData,
                                                                                                                     [
                                                                                                                      { dup: { n: 0 } },
                                                                                                                      { idx: { cached: false,
                                                                                                                               pushPath: false,
                                                                                                                               path: [
                                                                                                                                      { tag: 'value',
                                                                                                                                        value: { value: _descriptor_8.toValue(7n),
                                                                                                                                                 alignment: _descriptor_8.alignment() } }] } },
                                                                                                                      { popeq: { cached: false,
                                                                                                                                 result: undefined } }]).value),
                                                          use_counter_0);
    __compactRuntime.assert(_descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                      partialProofData,
                                                                                      [
                                                                                       { dup: { n: 0 } },
                                                                                       { idx: { cached: false,
                                                                                                pushPath: false,
                                                                                                path: [
                                                                                                       { tag: 'value',
                                                                                                         value: { value: _descriptor_8.toValue(6n),
                                                                                                                  alignment: _descriptor_8.alignment() } }] } },
                                                                                       { push: { storage: false,
                                                                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(entry_0),
                                                                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                                                                       'member',
                                                                                       { popeq: { cached: true,
                                                                                                  result: undefined } }]).value),
                            'unknown device entry');
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_8.toValue(6n),
                                                                  alignment: _descriptor_8.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(entry_0),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { rem: { cached: false } },
                                       { ins: { cached: true, n: 1 } }]);
    const tmp_0 = this._derive_device_entry_with_k256_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                  partialProofData,
                                                                                                                  [
                                                                                                                   { dup: { n: 2 } },
                                                                                                                   { idx: { cached: true,
                                                                                                                            pushPath: false,
                                                                                                                            path: [
                                                                                                                                   { tag: 'value',
                                                                                                                                     value: { value: _descriptor_8.toValue(0n),
                                                                                                                                              alignment: _descriptor_8.alignment() } }] } },
                                                                                                                   { popeq: { cached: true,
                                                                                                                              result: undefined } }]).value),
                                                        pk_0,
                                                        envelope_0,
                                                        _descriptor_11.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                   partialProofData,
                                                                                                                   [
                                                                                                                    { dup: { n: 0 } },
                                                                                                                    { idx: { cached: false,
                                                                                                                             pushPath: false,
                                                                                                                             path: [
                                                                                                                                    { tag: 'value',
                                                                                                                                      value: { value: _descriptor_8.toValue(7n),
                                                                                                                                               alignment: _descriptor_8.alignment() } }] } },
                                                                                                                    { popeq: { cached: false,
                                                                                                                               result: undefined } }]).value),
                                                        ((t1) => {
                                                          if (t1 > 18446744073709551615n) {
                                                            throw new __compactRuntime.CompactError('account.compact line 812 char 6: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                                                          }
                                                          return t1;
                                                        })(use_counter_0 + 1n));
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_8.toValue(6n),
                                                                  alignment: _descriptor_8.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(tmp_0),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newNull().encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    const digest_0 = this._envelope_digest_0(envelope_0, challenge_0);
    __compactRuntime.assert(this._secp256k1EcdsaVerify_0(digest_0, sig_0, pk_0),
                            'invalid signature');
    const tmp_1 = ((t1) => {
                    if (t1 > 18446744073709551615n) {
                      throw new __compactRuntime.CompactError('account.compact line 826 char 17: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                    }
                    return t1;
                  })(_descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                               partialProofData,
                                                                               [
                                                                                { dup: { n: 0 } },
                                                                                { idx: { cached: false,
                                                                                         pushPath: false,
                                                                                         path: [
                                                                                                { tag: 'value',
                                                                                                  value: { value: _descriptor_8.toValue(9n),
                                                                                                           alignment: _descriptor_8.alignment() } }] } },
                                                                                { popeq: { cached: false,
                                                                                           result: undefined } }]).value)
                     +
                     1n);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(9n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(tmp_1),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    await this._bump_round_0(context, partialProofData);
    return [];
  }
  async _bump_round_0(context, partialProofData) {
    const tmp_0 = ((t1) => {
                    if (t1 > 18446744073709551615n) {
                      throw new __compactRuntime.CompactError('account.compact line 831 char 12: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                    }
                    return t1;
                  })(_descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                               partialProofData,
                                                                               [
                                                                                { dup: { n: 0 } },
                                                                                { idx: { cached: false,
                                                                                         pushPath: false,
                                                                                         path: [
                                                                                                { tag: 'value',
                                                                                                  value: { value: _descriptor_8.toValue(0n),
                                                                                                           alignment: _descriptor_8.alignment() } }] } },
                                                                                { popeq: { cached: false,
                                                                                           result: undefined } }]).value)
                     +
                     1n);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(0n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(tmp_0),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    return [];
  }
  async _credit_unshielded_0(context, partialProofData, color_0, amount_0) {
    if (_descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                  partialProofData,
                                                                  [
                                                                   { dup: { n: 0 } },
                                                                   { idx: { cached: false,
                                                                            pushPath: false,
                                                                            path: [
                                                                                   { tag: 'value',
                                                                                     value: { value: _descriptor_8.toValue(4n),
                                                                                              alignment: _descriptor_8.alignment() } }] } },
                                                                   { push: { storage: false,
                                                                             value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(color_0),
                                                                                                                          alignment: _descriptor_1.alignment() }).encode() } },
                                                                   'member',
                                                                   { popeq: { cached: true,
                                                                              result: undefined } }]).value))
    {
      const tmp_0 = ((t1) => {
                      if (t1 > 340282366920938463463374607431768211455n) {
                        throw new __compactRuntime.CompactError('account.compact line 840 char 8: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 340282366920938463463374607431768211455');
                      }
                      return t1;
                    })(_descriptor_10.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                  partialProofData,
                                                                                  [
                                                                                   { dup: { n: 0 } },
                                                                                   { idx: { cached: false,
                                                                                            pushPath: false,
                                                                                            path: [
                                                                                                   { tag: 'value',
                                                                                                     value: { value: _descriptor_8.toValue(4n),
                                                                                                              alignment: _descriptor_8.alignment() } }] } },
                                                                                   { idx: { cached: false,
                                                                                            pushPath: false,
                                                                                            path: [
                                                                                                   { tag: 'value',
                                                                                                     value: { value: _descriptor_1.toValue(color_0),
                                                                                                              alignment: _descriptor_1.alignment() } }] } },
                                                                                   { popeq: { cached: false,
                                                                                              result: undefined } }]).value)
                       +
                       amount_0);
      __compactRuntime.queryLedgerState(context,
                                        partialProofData,
                                        [
                                         { idx: { cached: false,
                                                  pushPath: true,
                                                  path: [
                                                         { tag: 'value',
                                                           value: { value: _descriptor_8.toValue(4n),
                                                                    alignment: _descriptor_8.alignment() } }] } },
                                         { push: { storage: false,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(color_0),
                                                                                                alignment: _descriptor_1.alignment() }).encode() } },
                                         { push: { storage: true,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_10.toValue(tmp_0),
                                                                                                alignment: _descriptor_10.alignment() }).encode() } },
                                         { ins: { cached: false, n: 1 } },
                                         { ins: { cached: true, n: 1 } }]);
    } else {
      __compactRuntime.queryLedgerState(context,
                                        partialProofData,
                                        [
                                         { idx: { cached: false,
                                                  pushPath: true,
                                                  path: [
                                                         { tag: 'value',
                                                           value: { value: _descriptor_8.toValue(4n),
                                                                    alignment: _descriptor_8.alignment() } }] } },
                                         { push: { storage: false,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(color_0),
                                                                                                alignment: _descriptor_1.alignment() }).encode() } },
                                         { push: { storage: true,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_10.toValue(amount_0),
                                                                                                alignment: _descriptor_10.alignment() }).encode() } },
                                         { ins: { cached: false, n: 1 } },
                                         { ins: { cached: true, n: 1 } }]);
    }
    return [];
  }
  async _debit_unshielded_0(context, partialProofData, color_0, amount_0) {
    __compactRuntime.assert(_descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                      partialProofData,
                                                                                      [
                                                                                       { dup: { n: 0 } },
                                                                                       { idx: { cached: false,
                                                                                                pushPath: false,
                                                                                                path: [
                                                                                                       { tag: 'value',
                                                                                                         value: { value: _descriptor_8.toValue(4n),
                                                                                                                  alignment: _descriptor_8.alignment() } }] } },
                                                                                       { push: { storage: false,
                                                                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(color_0),
                                                                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                                                                       'member',
                                                                                       { popeq: { cached: true,
                                                                                                  result: undefined } }]).value),
                            'no balance for color');
    const bal_0 = _descriptor_10.fromValue(__compactRuntime.queryLedgerState(context,
                                                                             partialProofData,
                                                                             [
                                                                              { dup: { n: 0 } },
                                                                              { idx: { cached: false,
                                                                                       pushPath: false,
                                                                                       path: [
                                                                                              { tag: 'value',
                                                                                                value: { value: _descriptor_8.toValue(4n),
                                                                                                         alignment: _descriptor_8.alignment() } }] } },
                                                                              { idx: { cached: false,
                                                                                       pushPath: false,
                                                                                       path: [
                                                                                              { tag: 'value',
                                                                                                value: { value: _descriptor_1.toValue(color_0),
                                                                                                         alignment: _descriptor_1.alignment() } }] } },
                                                                              { popeq: { cached: false,
                                                                                         result: undefined } }]).value);
    __compactRuntime.assert(bal_0 >= amount_0, 'insufficient balance');
    const tmp_0 = (__compactRuntime.assert(bal_0 >= amount_0,
                                           'result of subtraction would be negative'),
                   bal_0 - amount_0);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_8.toValue(4n),
                                                                  alignment: _descriptor_8.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(color_0),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_10.toValue(tmp_0),
                                                                                              alignment: _descriptor_10.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  async _do_withdraw_unshielded_0(context,
                                  partialProofData,
                                  color_0,
                                  amount_0,
                                  recipient_0)
  {
    const c_0 = color_0;
    const a_0 = amount_0;
    await this._debit_unshielded_0(context, partialProofData, c_0, a_0);
    await this._sendUnshielded_0(context,
                                 partialProofData,
                                 c_0,
                                 a_0,
                                 this._right_0(recipient_0));
    return [];
  }
  async _do_append_inbox_0(context, partialProofData, entry_0) {
    const tmp_0 = _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                            partialProofData,
                                                                            [
                                                                             { dup: { n: 0 } },
                                                                             { idx: { cached: false,
                                                                                      pushPath: false,
                                                                                      path: [
                                                                                             { tag: 'value',
                                                                                               value: { value: _descriptor_8.toValue(3n),
                                                                                                        alignment: _descriptor_8.alignment() } }] } },
                                                                             { popeq: { cached: false,
                                                                                        result: undefined } }]).value);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_8.toValue(2n),
                                                                  alignment: _descriptor_8.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(tmp_0),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_14.toValue(entry_0),
                                                                                              alignment: _descriptor_14.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    const tmp_1 = ((t1) => {
                    if (t1 > 18446744073709551615n) {
                      throw new __compactRuntime.CompactError('account.compact line 875 char 18: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                    }
                    return t1;
                  })(_descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                               partialProofData,
                                                                               [
                                                                                { dup: { n: 0 } },
                                                                                { idx: { cached: false,
                                                                                         pushPath: false,
                                                                                         path: [
                                                                                                { tag: 'value',
                                                                                                  value: { value: _descriptor_8.toValue(3n),
                                                                                                           alignment: _descriptor_8.alignment() } }] } },
                                                                                { popeq: { cached: false,
                                                                                           result: undefined } }]).value)
                     +
                     1n);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(3n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(tmp_1),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    return [];
  }
  async _do_withdraw_shielded_0(context,
                                partialProofData,
                                recipient_0,
                                amount_0,
                                coin_0)
  {
    const result_0 = await this._sendShielded_0(context,
                                                partialProofData,
                                                coin_0,
                                                this._left_1(recipient_0),
                                                amount_0);
    if (result_0.change.is_some) {
      return this._some_0(result_0.change.value);
    } else {
      return this._none_0();
    }
  }
  async _do_withdraw_shielded_to_contract_0(context,
                                            partialProofData,
                                            recipient_0,
                                            amount_0,
                                            coin_0)
  {
    const result_0 = await this._sendShielded_0(context,
                                                partialProofData,
                                                coin_0,
                                                this._right_1(recipient_0),
                                                amount_0);
    if (result_0.change.is_some) {
      return [result_0.sent, this._some_0(result_0.change.value)];
    } else {
      return [result_0.sent, this._none_0()];
    }
  }
  async _do_rotate_enc_key_0(context, partialProofData, new_key_0) {
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(1n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(new_key_0),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    return [];
  }
  async _do_add_device_0(context, partialProofData, new_entry_0) {
    const e_0 = new_entry_0;
    __compactRuntime.assert(!_descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_8.toValue(6n),
                                                                                                                   alignment: _descriptor_8.alignment() } }] } },
                                                                                        { push: { storage: false,
                                                                                                  value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(e_0),
                                                                                                                                               alignment: _descriptor_1.alignment() }).encode() } },
                                                                                        'member',
                                                                                        { popeq: { cached: true,
                                                                                                   result: undefined } }]).value),
                            'device entry already present');
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_8.toValue(6n),
                                                                  alignment: _descriptor_8.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(e_0),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newNull().encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    const tmp_0 = ((t1) => {
                    if (t1 > 255n) {
                      throw new __compactRuntime.CompactError('account.compact line 929 char 19: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 255');
                    }
                    return t1;
                  })(_descriptor_8.fromValue(__compactRuntime.queryLedgerState(context,
                                                                               partialProofData,
                                                                               [
                                                                                { dup: { n: 0 } },
                                                                                { idx: { cached: false,
                                                                                         pushPath: false,
                                                                                         path: [
                                                                                                { tag: 'value',
                                                                                                  value: { value: _descriptor_8.toValue(8n),
                                                                                                           alignment: _descriptor_8.alignment() } }] } },
                                                                                { popeq: { cached: false,
                                                                                           result: undefined } }]).value)
                     +
                     1n);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(8n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(tmp_0),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    return [];
  }
  async _do_remove_device_0(context, partialProofData, entry_0, caller_entry_0)
  {
    const e_0 = entry_0;
    let t_0;
    __compactRuntime.assert((t_0 = _descriptor_8.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                             partialProofData,
                                                                                             [
                                                                                              { dup: { n: 0 } },
                                                                                              { idx: { cached: false,
                                                                                                       pushPath: false,
                                                                                                       path: [
                                                                                                              { tag: 'value',
                                                                                                                value: { value: _descriptor_8.toValue(8n),
                                                                                                                         alignment: _descriptor_8.alignment() } }] } },
                                                                                              { popeq: { cached: false,
                                                                                                         result: undefined } }]).value),
                             t_0 > 1n),
                            'cannot remove last device');
    __compactRuntime.assert(!this._equal_9(e_0, caller_entry_0),
                            'cannot remove the authorising device');
    __compactRuntime.assert(_descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                      partialProofData,
                                                                                      [
                                                                                       { dup: { n: 0 } },
                                                                                       { idx: { cached: false,
                                                                                                pushPath: false,
                                                                                                path: [
                                                                                                       { tag: 'value',
                                                                                                         value: { value: _descriptor_8.toValue(6n),
                                                                                                                  alignment: _descriptor_8.alignment() } }] } },
                                                                                       { push: { storage: false,
                                                                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(e_0),
                                                                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                                                                       'member',
                                                                                       { popeq: { cached: true,
                                                                                                  result: undefined } }]).value),
                            'unknown device entry');
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_8.toValue(6n),
                                                                  alignment: _descriptor_8.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(e_0),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { rem: { cached: false } },
                                       { ins: { cached: true, n: 1 } }]);
    let t_1, t_2;
    const tmp_0 = (t_1 = _descriptor_8.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                   partialProofData,
                                                                                   [
                                                                                    { dup: { n: 0 } },
                                                                                    { idx: { cached: false,
                                                                                             pushPath: false,
                                                                                             path: [
                                                                                                    { tag: 'value',
                                                                                                      value: { value: _descriptor_8.toValue(8n),
                                                                                                               alignment: _descriptor_8.alignment() } }] } },
                                                                                    { popeq: { cached: false,
                                                                                               result: undefined } }]).value),
                   (t_2 = 1n,
                    (__compactRuntime.assert(t_1 >= t_2,
                                             'result of subtraction would be negative'),
                     t_1 - t_2)));
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(8n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(tmp_0),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    return [];
  }
  async _deposit_unshielded_0(context, partialProofData, color_0, amount_0) {
    const c_0 = color_0;
    const a_0 = amount_0;
    await this._receiveUnshielded_0(context, partialProofData, c_0, a_0);
    await this._credit_unshielded_0(context, partialProofData, c_0, a_0);
    await this._bump_round_0(context, partialProofData);
    return [];
  }
  async _withdraw_unshielded_with_jubjub_0(context,
                                           partialProofData,
                                           color_0,
                                           amount_0,
                                           recipient_0,
                                           pk_0,
                                           use_counter_0,
                                           sig_r_0,
                                           sig_s_0,
                                           grind_nonce_0)
  {
    const challenge_0 = this._challenge_withdraw_unshielded_with_jubjub_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                    partialProofData,
                                                                                                                                    [
                                                                                                                                     { dup: { n: 2 } },
                                                                                                                                     { idx: { cached: true,
                                                                                                                                              pushPath: false,
                                                                                                                                              path: [
                                                                                                                                                     { tag: 'value',
                                                                                                                                                       value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                                alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                     { popeq: { cached: true,
                                                                                                                                                result: undefined } }]).value),
                                                                          sig_r_0,
                                                                          pk_0,
                                                                          color_0,
                                                                          amount_0,
                                                                          recipient_0,
                                                                          _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                    partialProofData,
                                                                                                                                    [
                                                                                                                                     { dup: { n: 0 } },
                                                                                                                                     { idx: { cached: false,
                                                                                                                                              pushPath: false,
                                                                                                                                              path: [
                                                                                                                                                     { tag: 'value',
                                                                                                                                                       value: { value: _descriptor_8.toValue(9n),
                                                                                                                                                                alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                     { popeq: { cached: false,
                                                                                                                                                result: undefined } }]).value),
                                                                          grind_nonce_0);
    await this._require_authorised_with_jubjub_0(context,
                                                 partialProofData,
                                                 pk_0,
                                                 use_counter_0,
                                                 sig_r_0,
                                                 sig_s_0,
                                                 challenge_0);
    await this._do_withdraw_unshielded_0(context,
                                         partialProofData,
                                         color_0,
                                         amount_0,
                                         recipient_0);
    return [];
  }
  async _withdraw_unshielded_with_k256_0(context,
                                         partialProofData,
                                         color_0,
                                         amount_0,
                                         recipient_0,
                                         pk_0,
                                         use_counter_0,
                                         sig_0,
                                         envelope_0)
  {
    const challenge_0 = this._challenge_withdraw_unshielded_with_k256_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                  partialProofData,
                                                                                                                                  [
                                                                                                                                   { dup: { n: 2 } },
                                                                                                                                   { idx: { cached: true,
                                                                                                                                            pushPath: false,
                                                                                                                                            path: [
                                                                                                                                                   { tag: 'value',
                                                                                                                                                     value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                              alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                   { popeq: { cached: true,
                                                                                                                                              result: undefined } }]).value),
                                                                        pk_0,
                                                                        color_0,
                                                                        amount_0,
                                                                        recipient_0,
                                                                        _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                  partialProofData,
                                                                                                                                  [
                                                                                                                                   { dup: { n: 0 } },
                                                                                                                                   { idx: { cached: false,
                                                                                                                                            pushPath: false,
                                                                                                                                            path: [
                                                                                                                                                   { tag: 'value',
                                                                                                                                                     value: { value: _descriptor_8.toValue(9n),
                                                                                                                                                              alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                   { popeq: { cached: false,
                                                                                                                                              result: undefined } }]).value));
    await this._require_authorised_with_k256_0(context,
                                               partialProofData,
                                               pk_0,
                                               use_counter_0,
                                               sig_0,
                                               challenge_0,
                                               envelope_0);
    await this._do_withdraw_unshielded_0(context,
                                         partialProofData,
                                         color_0,
                                         amount_0,
                                         recipient_0);
    return [];
  }
  async _deposit_shielded_0(context, partialProofData, coin_0, entry_0) {
    await this._receiveShielded_0(context, partialProofData, coin_0);
    const tmp_0 = _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                            partialProofData,
                                                                            [
                                                                             { dup: { n: 0 } },
                                                                             { idx: { cached: false,
                                                                                      pushPath: false,
                                                                                      path: [
                                                                                             { tag: 'value',
                                                                                               value: { value: _descriptor_8.toValue(3n),
                                                                                                        alignment: _descriptor_8.alignment() } }] } },
                                                                             { popeq: { cached: false,
                                                                                        result: undefined } }]).value);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_8.toValue(2n),
                                                                  alignment: _descriptor_8.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(tmp_0),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_14.toValue(entry_0),
                                                                                              alignment: _descriptor_14.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    const tmp_1 = ((t1) => {
                    if (t1 > 18446744073709551615n) {
                      throw new __compactRuntime.CompactError('account.compact line 1012 char 18: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                    }
                    return t1;
                  })(_descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                               partialProofData,
                                                                               [
                                                                                { dup: { n: 0 } },
                                                                                { idx: { cached: false,
                                                                                         pushPath: false,
                                                                                         path: [
                                                                                                { tag: 'value',
                                                                                                  value: { value: _descriptor_8.toValue(3n),
                                                                                                           alignment: _descriptor_8.alignment() } }] } },
                                                                                { popeq: { cached: false,
                                                                                           result: undefined } }]).value)
                     +
                     1n);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(3n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(tmp_1),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    await this._bump_round_0(context, partialProofData);
    return [];
  }
  async _append_inbox_with_jubjub_0(context,
                                    partialProofData,
                                    entry_0,
                                    pk_0,
                                    use_counter_0,
                                    sig_r_0,
                                    sig_s_0,
                                    grind_nonce_0)
  {
    const challenge_0 = this._challenge_append_inbox_with_jubjub_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                             partialProofData,
                                                                                                                             [
                                                                                                                              { dup: { n: 2 } },
                                                                                                                              { idx: { cached: true,
                                                                                                                                       pushPath: false,
                                                                                                                                       path: [
                                                                                                                                              { tag: 'value',
                                                                                                                                                value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                         alignment: _descriptor_8.alignment() } }] } },
                                                                                                                              { popeq: { cached: true,
                                                                                                                                         result: undefined } }]).value),
                                                                   sig_r_0,
                                                                   pk_0,
                                                                   entry_0,
                                                                   _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                             partialProofData,
                                                                                                                             [
                                                                                                                              { dup: { n: 0 } },
                                                                                                                              { idx: { cached: false,
                                                                                                                                       pushPath: false,
                                                                                                                                       path: [
                                                                                                                                              { tag: 'value',
                                                                                                                                                value: { value: _descriptor_8.toValue(9n),
                                                                                                                                                         alignment: _descriptor_8.alignment() } }] } },
                                                                                                                              { popeq: { cached: false,
                                                                                                                                         result: undefined } }]).value),
                                                                   grind_nonce_0);
    await this._require_authorised_with_jubjub_0(context,
                                                 partialProofData,
                                                 pk_0,
                                                 use_counter_0,
                                                 sig_r_0,
                                                 sig_s_0,
                                                 challenge_0);
    await this._do_append_inbox_0(context, partialProofData, entry_0);
    return [];
  }
  async _append_inbox_with_k256_0(context,
                                  partialProofData,
                                  entry_0,
                                  pk_0,
                                  use_counter_0,
                                  sig_0,
                                  envelope_0)
  {
    const challenge_0 = this._challenge_append_inbox_with_k256_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                           partialProofData,
                                                                                                                           [
                                                                                                                            { dup: { n: 2 } },
                                                                                                                            { idx: { cached: true,
                                                                                                                                     pushPath: false,
                                                                                                                                     path: [
                                                                                                                                            { tag: 'value',
                                                                                                                                              value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                       alignment: _descriptor_8.alignment() } }] } },
                                                                                                                            { popeq: { cached: true,
                                                                                                                                       result: undefined } }]).value),
                                                                 pk_0,
                                                                 entry_0,
                                                                 _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                           partialProofData,
                                                                                                                           [
                                                                                                                            { dup: { n: 0 } },
                                                                                                                            { idx: { cached: false,
                                                                                                                                     pushPath: false,
                                                                                                                                     path: [
                                                                                                                                            { tag: 'value',
                                                                                                                                              value: { value: _descriptor_8.toValue(9n),
                                                                                                                                                       alignment: _descriptor_8.alignment() } }] } },
                                                                                                                            { popeq: { cached: false,
                                                                                                                                       result: undefined } }]).value));
    await this._require_authorised_with_k256_0(context,
                                               partialProofData,
                                               pk_0,
                                               use_counter_0,
                                               sig_0,
                                               challenge_0,
                                               envelope_0);
    await this._do_append_inbox_0(context, partialProofData, entry_0);
    return [];
  }
  async _withdraw_shielded_with_jubjub_0(context,
                                         partialProofData,
                                         recipient_0,
                                         color_0,
                                         amount_0,
                                         pk_0,
                                         use_counter_0,
                                         sig_r_0,
                                         sig_s_0,
                                         grind_nonce_0)
  {
    const coin_0 = this._held_coin_0(context, partialProofData, color_0);
    const challenge_0 = this._challenge_withdraw_shielded_with_jubjub_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                  partialProofData,
                                                                                                                                  [
                                                                                                                                   { dup: { n: 2 } },
                                                                                                                                   { idx: { cached: true,
                                                                                                                                            pushPath: false,
                                                                                                                                            path: [
                                                                                                                                                   { tag: 'value',
                                                                                                                                                     value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                              alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                   { popeq: { cached: true,
                                                                                                                                              result: undefined } }]).value),
                                                                        sig_r_0,
                                                                        pk_0,
                                                                        recipient_0,
                                                                        color_0,
                                                                        amount_0,
                                                                        coin_0,
                                                                        _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                  partialProofData,
                                                                                                                                  [
                                                                                                                                   { dup: { n: 0 } },
                                                                                                                                   { idx: { cached: false,
                                                                                                                                            pushPath: false,
                                                                                                                                            path: [
                                                                                                                                                   { tag: 'value',
                                                                                                                                                     value: { value: _descriptor_8.toValue(9n),
                                                                                                                                                              alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                   { popeq: { cached: false,
                                                                                                                                              result: undefined } }]).value),
                                                                        grind_nonce_0);
    await this._require_authorised_with_jubjub_0(context,
                                                 partialProofData,
                                                 pk_0,
                                                 use_counter_0,
                                                 sig_r_0,
                                                 sig_s_0,
                                                 challenge_0);
    return await this._do_withdraw_shielded_0(context,
                                              partialProofData,
                                              recipient_0,
                                              amount_0,
                                              coin_0);
  }
  async _withdraw_shielded_with_k256_0(context,
                                       partialProofData,
                                       recipient_0,
                                       color_0,
                                       amount_0,
                                       pk_0,
                                       use_counter_0,
                                       sig_0,
                                       envelope_0)
  {
    const coin_0 = this._held_coin_0(context, partialProofData, color_0);
    const challenge_0 = this._challenge_withdraw_shielded_with_k256_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                partialProofData,
                                                                                                                                [
                                                                                                                                 { dup: { n: 2 } },
                                                                                                                                 { idx: { cached: true,
                                                                                                                                          pushPath: false,
                                                                                                                                          path: [
                                                                                                                                                 { tag: 'value',
                                                                                                                                                   value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                            alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                 { popeq: { cached: true,
                                                                                                                                            result: undefined } }]).value),
                                                                      pk_0,
                                                                      recipient_0,
                                                                      color_0,
                                                                      amount_0,
                                                                      coin_0,
                                                                      _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                partialProofData,
                                                                                                                                [
                                                                                                                                 { dup: { n: 0 } },
                                                                                                                                 { idx: { cached: false,
                                                                                                                                          pushPath: false,
                                                                                                                                          path: [
                                                                                                                                                 { tag: 'value',
                                                                                                                                                   value: { value: _descriptor_8.toValue(9n),
                                                                                                                                                            alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                 { popeq: { cached: false,
                                                                                                                                            result: undefined } }]).value));
    await this._require_authorised_with_k256_0(context,
                                               partialProofData,
                                               pk_0,
                                               use_counter_0,
                                               sig_0,
                                               challenge_0,
                                               envelope_0);
    return await this._do_withdraw_shielded_0(context,
                                              partialProofData,
                                              recipient_0,
                                              amount_0,
                                              coin_0);
  }
  async _withdraw_shielded_to_contract_with_jubjub_0(context,
                                                     partialProofData,
                                                     recipient_0,
                                                     color_0,
                                                     amount_0,
                                                     pk_0,
                                                     use_counter_0,
                                                     sig_r_0,
                                                     sig_s_0,
                                                     grind_nonce_0)
  {
    const coin_0 = this._held_coin_0(context, partialProofData, color_0);
    const challenge_0 = this._challenge_withdraw_shielded_to_contract_with_jubjub_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                              partialProofData,
                                                                                                                                              [
                                                                                                                                               { dup: { n: 2 } },
                                                                                                                                               { idx: { cached: true,
                                                                                                                                                        pushPath: false,
                                                                                                                                                        path: [
                                                                                                                                                               { tag: 'value',
                                                                                                                                                                 value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                                          alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                               { popeq: { cached: true,
                                                                                                                                                          result: undefined } }]).value),
                                                                                    sig_r_0,
                                                                                    pk_0,
                                                                                    recipient_0,
                                                                                    color_0,
                                                                                    amount_0,
                                                                                    coin_0,
                                                                                    _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                              partialProofData,
                                                                                                                                              [
                                                                                                                                               { dup: { n: 0 } },
                                                                                                                                               { idx: { cached: false,
                                                                                                                                                        pushPath: false,
                                                                                                                                                        path: [
                                                                                                                                                               { tag: 'value',
                                                                                                                                                                 value: { value: _descriptor_8.toValue(9n),
                                                                                                                                                                          alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                               { popeq: { cached: false,
                                                                                                                                                          result: undefined } }]).value),
                                                                                    grind_nonce_0);
    await this._require_authorised_with_jubjub_0(context,
                                                 partialProofData,
                                                 pk_0,
                                                 use_counter_0,
                                                 sig_r_0,
                                                 sig_s_0,
                                                 challenge_0);
    return await this._do_withdraw_shielded_to_contract_0(context,
                                                          partialProofData,
                                                          recipient_0,
                                                          amount_0,
                                                          coin_0);
  }
  async _withdraw_shielded_to_contract_with_k256_0(context,
                                                   partialProofData,
                                                   recipient_0,
                                                   color_0,
                                                   amount_0,
                                                   pk_0,
                                                   use_counter_0,
                                                   sig_0,
                                                   envelope_0)
  {
    const coin_0 = this._held_coin_0(context, partialProofData, color_0);
    const challenge_0 = this._challenge_withdraw_shielded_to_contract_with_k256_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                            partialProofData,
                                                                                                                                            [
                                                                                                                                             { dup: { n: 2 } },
                                                                                                                                             { idx: { cached: true,
                                                                                                                                                      pushPath: false,
                                                                                                                                                      path: [
                                                                                                                                                             { tag: 'value',
                                                                                                                                                               value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                                        alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                             { popeq: { cached: true,
                                                                                                                                                        result: undefined } }]).value),
                                                                                  pk_0,
                                                                                  recipient_0,
                                                                                  color_0,
                                                                                  amount_0,
                                                                                  coin_0,
                                                                                  _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                            partialProofData,
                                                                                                                                            [
                                                                                                                                             { dup: { n: 0 } },
                                                                                                                                             { idx: { cached: false,
                                                                                                                                                      pushPath: false,
                                                                                                                                                      path: [
                                                                                                                                                             { tag: 'value',
                                                                                                                                                               value: { value: _descriptor_8.toValue(9n),
                                                                                                                                                                        alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                             { popeq: { cached: false,
                                                                                                                                                        result: undefined } }]).value));
    await this._require_authorised_with_k256_0(context,
                                               partialProofData,
                                               pk_0,
                                               use_counter_0,
                                               sig_0,
                                               challenge_0,
                                               envelope_0);
    return await this._do_withdraw_shielded_to_contract_0(context,
                                                          partialProofData,
                                                          recipient_0,
                                                          amount_0,
                                                          coin_0);
  }
  async _rotate_enc_key_with_jubjub_0(context,
                                      partialProofData,
                                      new_key_0,
                                      pk_0,
                                      use_counter_0,
                                      sig_r_0,
                                      sig_s_0,
                                      grind_nonce_0)
  {
    const challenge_0 = this._challenge_rotate_enc_key_with_jubjub_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                               partialProofData,
                                                                                                                               [
                                                                                                                                { dup: { n: 2 } },
                                                                                                                                { idx: { cached: true,
                                                                                                                                         pushPath: false,
                                                                                                                                         path: [
                                                                                                                                                { tag: 'value',
                                                                                                                                                  value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                           alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                { popeq: { cached: true,
                                                                                                                                           result: undefined } }]).value),
                                                                     sig_r_0,
                                                                     pk_0,
                                                                     new_key_0,
                                                                     _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                               partialProofData,
                                                                                                                               [
                                                                                                                                { dup: { n: 0 } },
                                                                                                                                { idx: { cached: false,
                                                                                                                                         pushPath: false,
                                                                                                                                         path: [
                                                                                                                                                { tag: 'value',
                                                                                                                                                  value: { value: _descriptor_8.toValue(9n),
                                                                                                                                                           alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                { popeq: { cached: false,
                                                                                                                                           result: undefined } }]).value),
                                                                     grind_nonce_0);
    await this._require_authorised_with_jubjub_0(context,
                                                 partialProofData,
                                                 pk_0,
                                                 use_counter_0,
                                                 sig_r_0,
                                                 sig_s_0,
                                                 challenge_0);
    await this._do_rotate_enc_key_0(context, partialProofData, new_key_0);
    return [];
  }
  async _rotate_enc_key_with_k256_0(context,
                                    partialProofData,
                                    new_key_0,
                                    pk_0,
                                    use_counter_0,
                                    sig_0,
                                    envelope_0)
  {
    const challenge_0 = this._challenge_rotate_enc_key_with_k256_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                             partialProofData,
                                                                                                                             [
                                                                                                                              { dup: { n: 2 } },
                                                                                                                              { idx: { cached: true,
                                                                                                                                       pushPath: false,
                                                                                                                                       path: [
                                                                                                                                              { tag: 'value',
                                                                                                                                                value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                         alignment: _descriptor_8.alignment() } }] } },
                                                                                                                              { popeq: { cached: true,
                                                                                                                                         result: undefined } }]).value),
                                                                   pk_0,
                                                                   new_key_0,
                                                                   _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                             partialProofData,
                                                                                                                             [
                                                                                                                              { dup: { n: 0 } },
                                                                                                                              { idx: { cached: false,
                                                                                                                                       pushPath: false,
                                                                                                                                       path: [
                                                                                                                                              { tag: 'value',
                                                                                                                                                value: { value: _descriptor_8.toValue(9n),
                                                                                                                                                         alignment: _descriptor_8.alignment() } }] } },
                                                                                                                              { popeq: { cached: false,
                                                                                                                                         result: undefined } }]).value));
    await this._require_authorised_with_k256_0(context,
                                               partialProofData,
                                               pk_0,
                                               use_counter_0,
                                               sig_0,
                                               challenge_0,
                                               envelope_0);
    await this._do_rotate_enc_key_0(context, partialProofData, new_key_0);
    return [];
  }
  async _add_device_with_jubjub_0(context,
                                  partialProofData,
                                  new_entry_0,
                                  pk_0,
                                  use_counter_0,
                                  sig_r_0,
                                  sig_s_0,
                                  grind_nonce_0)
  {
    const challenge_0 = this._challenge_add_device_with_jubjub_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                           partialProofData,
                                                                                                                           [
                                                                                                                            { dup: { n: 2 } },
                                                                                                                            { idx: { cached: true,
                                                                                                                                     pushPath: false,
                                                                                                                                     path: [
                                                                                                                                            { tag: 'value',
                                                                                                                                              value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                       alignment: _descriptor_8.alignment() } }] } },
                                                                                                                            { popeq: { cached: true,
                                                                                                                                       result: undefined } }]).value),
                                                                 sig_r_0,
                                                                 pk_0,
                                                                 new_entry_0,
                                                                 _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                           partialProofData,
                                                                                                                           [
                                                                                                                            { dup: { n: 0 } },
                                                                                                                            { idx: { cached: false,
                                                                                                                                     pushPath: false,
                                                                                                                                     path: [
                                                                                                                                            { tag: 'value',
                                                                                                                                              value: { value: _descriptor_8.toValue(9n),
                                                                                                                                                       alignment: _descriptor_8.alignment() } }] } },
                                                                                                                            { popeq: { cached: false,
                                                                                                                                       result: undefined } }]).value),
                                                                 grind_nonce_0);
    await this._require_authorised_with_jubjub_0(context,
                                                 partialProofData,
                                                 pk_0,
                                                 use_counter_0,
                                                 sig_r_0,
                                                 sig_s_0,
                                                 challenge_0);
    await this._do_add_device_0(context, partialProofData, new_entry_0);
    return [];
  }
  async _add_device_with_k256_0(context,
                                partialProofData,
                                new_entry_0,
                                pk_0,
                                use_counter_0,
                                sig_0,
                                envelope_0)
  {
    const challenge_0 = this._challenge_add_device_with_k256_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                         partialProofData,
                                                                                                                         [
                                                                                                                          { dup: { n: 2 } },
                                                                                                                          { idx: { cached: true,
                                                                                                                                   pushPath: false,
                                                                                                                                   path: [
                                                                                                                                          { tag: 'value',
                                                                                                                                            value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                     alignment: _descriptor_8.alignment() } }] } },
                                                                                                                          { popeq: { cached: true,
                                                                                                                                     result: undefined } }]).value),
                                                               pk_0,
                                                               new_entry_0,
                                                               _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                         partialProofData,
                                                                                                                         [
                                                                                                                          { dup: { n: 0 } },
                                                                                                                          { idx: { cached: false,
                                                                                                                                   pushPath: false,
                                                                                                                                   path: [
                                                                                                                                          { tag: 'value',
                                                                                                                                            value: { value: _descriptor_8.toValue(9n),
                                                                                                                                                     alignment: _descriptor_8.alignment() } }] } },
                                                                                                                          { popeq: { cached: false,
                                                                                                                                     result: undefined } }]).value));
    await this._require_authorised_with_k256_0(context,
                                               partialProofData,
                                               pk_0,
                                               use_counter_0,
                                               sig_0,
                                               challenge_0,
                                               envelope_0);
    await this._do_add_device_0(context, partialProofData, new_entry_0);
    return [];
  }
  async _remove_device_with_jubjub_0(context,
                                     partialProofData,
                                     entry_0,
                                     pk_0,
                                     use_counter_0,
                                     sig_r_0,
                                     sig_s_0,
                                     grind_nonce_0)
  {
    const challenge_0 = this._challenge_remove_device_with_jubjub_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                              partialProofData,
                                                                                                                              [
                                                                                                                               { dup: { n: 2 } },
                                                                                                                               { idx: { cached: true,
                                                                                                                                        pushPath: false,
                                                                                                                                        path: [
                                                                                                                                               { tag: 'value',
                                                                                                                                                 value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                          alignment: _descriptor_8.alignment() } }] } },
                                                                                                                               { popeq: { cached: true,
                                                                                                                                          result: undefined } }]).value),
                                                                    sig_r_0,
                                                                    pk_0,
                                                                    entry_0,
                                                                    _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                              partialProofData,
                                                                                                                              [
                                                                                                                               { dup: { n: 0 } },
                                                                                                                               { idx: { cached: false,
                                                                                                                                        pushPath: false,
                                                                                                                                        path: [
                                                                                                                                               { tag: 'value',
                                                                                                                                                 value: { value: _descriptor_8.toValue(9n),
                                                                                                                                                          alignment: _descriptor_8.alignment() } }] } },
                                                                                                                               { popeq: { cached: false,
                                                                                                                                          result: undefined } }]).value),
                                                                    grind_nonce_0);
    await this._require_authorised_with_jubjub_0(context,
                                                 partialProofData,
                                                 pk_0,
                                                 use_counter_0,
                                                 sig_r_0,
                                                 sig_s_0,
                                                 challenge_0);
    await this._do_remove_device_0(context,
                                   partialProofData,
                                   entry_0,
                                   this._derive_device_entry_with_jubjub_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                     partialProofData,
                                                                                                                                     [
                                                                                                                                      { dup: { n: 2 } },
                                                                                                                                      { idx: { cached: true,
                                                                                                                                               pushPath: false,
                                                                                                                                               path: [
                                                                                                                                                      { tag: 'value',
                                                                                                                                                        value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                                 alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                      { popeq: { cached: true,
                                                                                                                                                 result: undefined } }]).value),
                                                                           pk_0,
                                                                           _descriptor_11.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                      partialProofData,
                                                                                                                                      [
                                                                                                                                       { dup: { n: 0 } },
                                                                                                                                       { idx: { cached: false,
                                                                                                                                                pushPath: false,
                                                                                                                                                path: [
                                                                                                                                                       { tag: 'value',
                                                                                                                                                         value: { value: _descriptor_8.toValue(7n),
                                                                                                                                                                  alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                       { popeq: { cached: false,
                                                                                                                                                  result: undefined } }]).value),
                                                                           ((t1) => {
                                                                             if (t1 > 18446744073709551615n) {
                                                                               throw new __compactRuntime.CompactError('account.compact line 1290 char 39: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                                                                             }
                                                                             return t1;
                                                                           })(use_counter_0
                                                                              +
                                                                              1n)));
    return [];
  }
  async _remove_device_with_k256_0(context,
                                   partialProofData,
                                   entry_0,
                                   pk_0,
                                   use_counter_0,
                                   sig_0,
                                   envelope_0)
  {
    const challenge_0 = this._challenge_remove_device_with_k256_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                            partialProofData,
                                                                                                                            [
                                                                                                                             { dup: { n: 2 } },
                                                                                                                             { idx: { cached: true,
                                                                                                                                      pushPath: false,
                                                                                                                                      path: [
                                                                                                                                             { tag: 'value',
                                                                                                                                               value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                        alignment: _descriptor_8.alignment() } }] } },
                                                                                                                             { popeq: { cached: true,
                                                                                                                                        result: undefined } }]).value),
                                                                  pk_0,
                                                                  entry_0,
                                                                  _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                            partialProofData,
                                                                                                                            [
                                                                                                                             { dup: { n: 0 } },
                                                                                                                             { idx: { cached: false,
                                                                                                                                      pushPath: false,
                                                                                                                                      path: [
                                                                                                                                             { tag: 'value',
                                                                                                                                               value: { value: _descriptor_8.toValue(9n),
                                                                                                                                                        alignment: _descriptor_8.alignment() } }] } },
                                                                                                                             { popeq: { cached: false,
                                                                                                                                        result: undefined } }]).value));
    await this._require_authorised_with_k256_0(context,
                                               partialProofData,
                                               pk_0,
                                               use_counter_0,
                                               sig_0,
                                               challenge_0,
                                               envelope_0);
    await this._do_remove_device_0(context,
                                   partialProofData,
                                   entry_0,
                                   this._derive_device_entry_with_k256_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                   partialProofData,
                                                                                                                                   [
                                                                                                                                    { dup: { n: 2 } },
                                                                                                                                    { idx: { cached: true,
                                                                                                                                             pushPath: false,
                                                                                                                                             path: [
                                                                                                                                                    { tag: 'value',
                                                                                                                                                      value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                               alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                    { popeq: { cached: true,
                                                                                                                                               result: undefined } }]).value),
                                                                         pk_0,
                                                                         envelope_0,
                                                                         _descriptor_11.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                    partialProofData,
                                                                                                                                    [
                                                                                                                                     { dup: { n: 0 } },
                                                                                                                                     { idx: { cached: false,
                                                                                                                                              pushPath: false,
                                                                                                                                              path: [
                                                                                                                                                     { tag: 'value',
                                                                                                                                                       value: { value: _descriptor_8.toValue(7n),
                                                                                                                                                                alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                     { popeq: { cached: false,
                                                                                                                                                result: undefined } }]).value),
                                                                         ((t1) => {
                                                                           if (t1 > 18446744073709551615n) {
                                                                             throw new __compactRuntime.CompactError('account.compact line 1308 char 6: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                                                                           }
                                                                           return t1;
                                                                         })(use_counter_0
                                                                            +
                                                                            1n)));
    return [];
  }
  _derive_grant_id_with_k256_0(self_addr_0,
                               pk_0,
                               envelope_0,
                               origin_hash_0,
                               slot_0)
  {
    return this._persistentHash_14([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 103, 114, 97, 110, 116, 58, 105, 100, 58, 107, 49, 58, 118, 49, 0]),
                                    self_addr_0,
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointX_0(pk_0),
                                                                          'account.compact line 1364 char 6'),
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointY_0(pk_0),
                                                                          'account.compact line 1364 char 40'),
                                    envelope_0,
                                    origin_hash_0,
                                    slot_0]);
  }
  _derive_grant_id_with_jubjub_0(self_addr_0, pk_0, origin_hash_0, slot_0) {
    return this._persistentHash_15([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 103, 114, 97, 110, 116, 58, 105, 100, 58, 118, 49, 0, 0, 0, 0]),
                                    self_addr_0,
                                    pk_0,
                                    origin_hash_0,
                                    slot_0]);
  }
  _derive_grant_object_commit_0(scope_salt_0,
                                color_0,
                                recipient_kind_0,
                                recipient_0,
                                max_coin_value_0)
  {
    return this._persistentHash_16([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 103, 114, 97, 110, 116, 58, 111, 98, 106, 58, 118, 49, 0, 0, 0]),
                                    scope_salt_0,
                                    color_0,
                                    recipient_kind_0,
                                    recipient_0,
                                    max_coin_value_0]);
  }
  _derive_grant_spent_commit_0(scope_salt_0, spent_0) {
    return this._persistentHash_17([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 103, 114, 97, 110, 116, 58, 115, 112, 101, 110, 116, 58, 118, 49, 0]),
                                    scope_salt_0,
                                    spent_0]);
  }
  _derive_grant_rp_commit_0(scope_salt_0, rp_id_hash_0) {
    return this._persistentHash_18([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 103, 114, 97, 110, 116, 58, 114, 112, 58, 118, 49, 0, 0, 0, 0]),
                                    scope_salt_0,
                                    rp_id_hash_0]);
  }
  _derive_grant_scope_digest_0(scope_salt_0,
                               op_withdraw_unshielded_0,
                               op_withdraw_shielded_0,
                               op_withdraw_shielded_to_contract_0,
                               read_0,
                               color_0,
                               recipient_kind_0,
                               recipient_0,
                               max_coin_value_0,
                               per_call_cap_0,
                               cap_0,
                               expires_at_0,
                               rp_id_hash_0,
                               read_pk_hash_0,
                               window_len_0,
                               window_cap_0)
  {
    return this._persistentHash_19([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 103, 114, 97, 110, 116, 58, 115, 99, 111, 112, 101, 58, 118, 49, 0]),
                                    scope_salt_0,
                                    op_withdraw_unshielded_0,
                                    op_withdraw_shielded_0,
                                    op_withdraw_shielded_to_contract_0,
                                    read_0,
                                    color_0,
                                    recipient_kind_0,
                                    recipient_0,
                                    max_coin_value_0,
                                    per_call_cap_0,
                                    cap_0,
                                    expires_at_0,
                                    rp_id_hash_0,
                                    read_pk_hash_0,
                                    window_len_0,
                                    window_cap_0]);
  }
  _challenge_withdraw_unshielded_with_grant_k256_0(self_addr_0,
                                                   pk_0,
                                                   grant_id_0,
                                                   issued_at_0,
                                                   color_0,
                                                   amount_0,
                                                   recipient_0,
                                                   nonce_value_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 103, 114, 97, 110, 116, 58, 97, 117, 116, 104, 58, 107, 49, 58, 118, 49, 58, 119, 105, 116, 104, 100, 114, 97, 119, 95, 117, 110, 115, 104, 105, 101, 108, 100, 101, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_20([dst_0,
                                    self_addr_0,
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointX_0(pk_0),
                                                                          'account.compact line 1473 char 6'),
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointY_0(pk_0),
                                                                          'account.compact line 1473 char 40'),
                                    grant_id_0,
                                    issued_at_0,
                                    color_0,
                                    amount_0,
                                    recipient_0,
                                    nonce_value_0]);
  }
  _challenge_withdraw_shielded_with_grant_k256_0(self_addr_0,
                                                 pk_0,
                                                 grant_id_0,
                                                 issued_at_0,
                                                 recipient_0,
                                                 color_0,
                                                 amount_0,
                                                 change_entry_0,
                                                 enc_pk_0,
                                                 coin_0,
                                                 nonce_value_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 103, 114, 97, 110, 116, 58, 97, 117, 116, 104, 58, 107, 49, 58, 118, 49, 58, 119, 105, 116, 104, 100, 114, 97, 119, 95, 115, 104, 105, 101, 108, 100, 101, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_21([dst_0,
                                    self_addr_0,
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointX_0(pk_0),
                                                                          'account.compact line 1498 char 6'),
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointY_0(pk_0),
                                                                          'account.compact line 1498 char 40'),
                                    grant_id_0,
                                    issued_at_0,
                                    recipient_0,
                                    color_0,
                                    amount_0,
                                    change_entry_0,
                                    enc_pk_0,
                                    coin_0,
                                    nonce_value_0]);
  }
  _challenge_withdraw_shielded_to_contract_with_grant_k256_0(self_addr_0,
                                                             pk_0,
                                                             grant_id_0,
                                                             issued_at_0,
                                                             recipient_0,
                                                             color_0,
                                                             amount_0,
                                                             change_entry_0,
                                                             enc_pk_0,
                                                             coin_0,
                                                             nonce_value_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 103, 114, 97, 110, 116, 58, 97, 117, 116, 104, 58, 107, 49, 58, 118, 49, 58, 119, 105, 116, 104, 100, 114, 97, 119, 95, 115, 104, 105, 101, 108, 100, 101, 100, 95, 116, 111, 95, 99, 111, 110, 116, 114, 97, 99, 116, 0])]);
    return this._persistentHash_22([dst_0,
                                    self_addr_0,
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointX_0(pk_0),
                                                                          'account.compact line 1523 char 6'),
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointY_0(pk_0),
                                                                          'account.compact line 1523 char 40'),
                                    grant_id_0,
                                    issued_at_0,
                                    recipient_0,
                                    color_0,
                                    amount_0,
                                    change_entry_0,
                                    enc_pk_0,
                                    coin_0,
                                    nonce_value_0]);
  }
  _challenge_withdraw_unshielded_with_grant_jubjub_0(self_addr_0,
                                                     sig_r_0,
                                                     pk_0,
                                                     grant_id_0,
                                                     issued_at_0,
                                                     color_0,
                                                     amount_0,
                                                     recipient_0,
                                                     nonce_value_0,
                                                     grind_nonce_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 103, 114, 97, 110, 116, 58, 97, 117, 116, 104, 58, 118, 49, 58, 119, 105, 116, 104, 100, 114, 97, 119, 95, 117, 110, 115, 104, 105, 101, 108, 100, 101, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_23([dst_0,
                                    self_addr_0,
                                    sig_r_0,
                                    pk_0,
                                    grant_id_0,
                                    issued_at_0,
                                    color_0,
                                    amount_0,
                                    recipient_0,
                                    nonce_value_0,
                                    grind_nonce_0]);
  }
  _challenge_withdraw_shielded_with_grant_jubjub_0(self_addr_0,
                                                   sig_r_0,
                                                   pk_0,
                                                   grant_id_0,
                                                   issued_at_0,
                                                   recipient_0,
                                                   color_0,
                                                   amount_0,
                                                   change_entry_0,
                                                   enc_pk_0,
                                                   coin_0,
                                                   nonce_value_0,
                                                   grind_nonce_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 103, 114, 97, 110, 116, 58, 97, 117, 116, 104, 58, 118, 49, 58, 119, 105, 116, 104, 100, 114, 97, 119, 95, 115, 104, 105, 101, 108, 100, 101, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_24([dst_0,
                                    self_addr_0,
                                    sig_r_0,
                                    pk_0,
                                    grant_id_0,
                                    issued_at_0,
                                    recipient_0,
                                    color_0,
                                    amount_0,
                                    change_entry_0,
                                    enc_pk_0,
                                    coin_0,
                                    nonce_value_0,
                                    grind_nonce_0]);
  }
  _challenge_withdraw_shielded_to_contract_with_grant_jubjub_0(self_addr_0,
                                                               sig_r_0,
                                                               pk_0,
                                                               grant_id_0,
                                                               issued_at_0,
                                                               recipient_0,
                                                               color_0,
                                                               amount_0,
                                                               change_entry_0,
                                                               enc_pk_0,
                                                               coin_0,
                                                               nonce_value_0,
                                                               grind_nonce_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 103, 114, 97, 110, 116, 58, 97, 117, 116, 104, 58, 118, 49, 58, 119, 105, 116, 104, 100, 114, 97, 119, 95, 115, 104, 105, 101, 108, 100, 101, 100, 95, 116, 111, 95, 99, 111, 110, 116, 114, 97, 99, 116, 0, 0, 0, 0])]);
    return this._persistentHash_25([dst_0,
                                    self_addr_0,
                                    sig_r_0,
                                    pk_0,
                                    grant_id_0,
                                    issued_at_0,
                                    recipient_0,
                                    color_0,
                                    amount_0,
                                    change_entry_0,
                                    enc_pk_0,
                                    coin_0,
                                    nonce_value_0,
                                    grind_nonce_0]);
  }
  _challenge_issue_grant_with_k256_0(self_addr_0,
                                     pk_0,
                                     grant_id_0,
                                     scope_digest_0,
                                     nonce_value_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 97, 117, 116, 104, 58, 107, 49, 58, 118, 49, 58, 105, 115, 115, 117, 101, 95, 103, 114, 97, 110, 116, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_26([dst_0,
                                    self_addr_0,
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointX_0(pk_0),
                                                                          'account.compact line 1632 char 6'),
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointY_0(pk_0),
                                                                          'account.compact line 1632 char 40'),
                                    grant_id_0,
                                    scope_digest_0,
                                    nonce_value_0]);
  }
  _challenge_revoke_grant_with_k256_0(self_addr_0,
                                      pk_0,
                                      grant_id_0,
                                      nonce_value_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 97, 117, 116, 104, 58, 107, 49, 58, 118, 49, 58, 114, 101, 118, 111, 107, 101, 95, 103, 114, 97, 110, 116, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_27([dst_0,
                                    self_addr_0,
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointX_0(pk_0),
                                                                          'account.compact line 1648 char 6'),
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointY_0(pk_0),
                                                                          'account.compact line 1648 char 40'),
                                    grant_id_0,
                                    nonce_value_0]);
  }
  _challenge_revoke_all_grants_with_k256_0(self_addr_0, pk_0, nonce_value_0) {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 97, 117, 116, 104, 58, 107, 49, 58, 118, 49, 58, 114, 101, 118, 111, 107, 101, 95, 97, 108, 108, 95, 103, 114, 97, 110, 116, 115, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_28([dst_0,
                                    self_addr_0,
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointX_0(pk_0),
                                                                          'account.compact line 1663 char 6'),
                                    __compactRuntime.convertBigintToBytes(32,
                                                                          this._secp256k1PointY_0(pk_0),
                                                                          'account.compact line 1663 char 40'),
                                    nonce_value_0]);
  }
  _challenge_issue_grant_with_jubjub_0(self_addr_0,
                                       sig_r_0,
                                       pk_0,
                                       grant_id_0,
                                       scope_digest_0,
                                       nonce_value_0,
                                       grind_nonce_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 97, 117, 116, 104, 58, 118, 49, 58, 105, 115, 115, 117, 101, 95, 103, 114, 97, 110, 116, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_29([dst_0,
                                    self_addr_0,
                                    sig_r_0,
                                    pk_0,
                                    grant_id_0,
                                    scope_digest_0,
                                    nonce_value_0,
                                    grind_nonce_0]);
  }
  _challenge_revoke_grant_with_jubjub_0(self_addr_0,
                                        sig_r_0,
                                        pk_0,
                                        grant_id_0,
                                        nonce_value_0,
                                        grind_nonce_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 97, 117, 116, 104, 58, 118, 49, 58, 114, 101, 118, 111, 107, 101, 95, 103, 114, 97, 110, 116, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_30([dst_0,
                                    self_addr_0,
                                    sig_r_0,
                                    pk_0,
                                    grant_id_0,
                                    nonce_value_0,
                                    grind_nonce_0]);
  }
  _challenge_revoke_all_grants_with_jubjub_0(self_addr_0,
                                             sig_r_0,
                                             pk_0,
                                             nonce_value_0,
                                             grind_nonce_0)
  {
    const dst_0 = this._persistentHash_31([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 97, 99, 99, 111, 117, 110, 116, 58, 97, 117, 116, 104, 58, 118, 49, 58, 114, 101, 118, 111, 107, 101, 95, 97, 108, 108, 95, 103, 114, 97, 110, 116, 115, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    return this._persistentHash_32([dst_0,
                                    self_addr_0,
                                    sig_r_0,
                                    pk_0,
                                    nonce_value_0,
                                    grind_nonce_0]);
  }
  async _authenticate_grant_with_k256_0(context,
                                        partialProofData,
                                        pk_0,
                                        envelope_0,
                                        origin_hash_0,
                                        slot_0)
  {
    __compactRuntime.assert(envelope_0 === 0n,
                            'envelope not admitted for a spend grant');
    this._require_live_k256_key_0(pk_0);
    const id_0 = this._derive_grant_id_with_k256_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                             partialProofData,
                                                                                                             [
                                                                                                              { dup: { n: 2 } },
                                                                                                              { idx: { cached: true,
                                                                                                                       pushPath: false,
                                                                                                                       path: [
                                                                                                                              { tag: 'value',
                                                                                                                                value: { value: _descriptor_8.toValue(0n),
                                                                                                                                         alignment: _descriptor_8.alignment() } }] } },
                                                                                                              { popeq: { cached: true,
                                                                                                                         result: undefined } }]).value),
                                                   pk_0,
                                                   envelope_0,
                                                   origin_hash_0,
                                                   slot_0);
    __compactRuntime.assert(_descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                      partialProofData,
                                                                                      [
                                                                                       { dup: { n: 0 } },
                                                                                       { idx: { cached: false,
                                                                                                pushPath: false,
                                                                                                path: [
                                                                                                       { tag: 'value',
                                                                                                         value: { value: _descriptor_8.toValue(12n),
                                                                                                                  alignment: _descriptor_8.alignment() } }] } },
                                                                                       { push: { storage: false,
                                                                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(id_0),
                                                                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                                                                       'member',
                                                                                       { popeq: { cached: true,
                                                                                                  result: undefined } }]).value),
                            'unknown grant');
    const g_0 = _descriptor_13.fromValue(__compactRuntime.queryLedgerState(context,
                                                                           partialProofData,
                                                                           [
                                                                            { dup: { n: 0 } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_8.toValue(12n),
                                                                                                       alignment: _descriptor_8.alignment() } }] } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_1.toValue(id_0),
                                                                                                       alignment: _descriptor_1.alignment() } }] } },
                                                                            { popeq: { cached: false,
                                                                                       result: undefined } }]).value);
    __compactRuntime.assert(g_0.active, 'grant revoked');
    __compactRuntime.assert(g_0.epoch
                            ===
                            _descriptor_11.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_8.toValue(7n),
                                                                                                                   alignment: _descriptor_8.alignment() } }] } },
                                                                                        { popeq: { cached: false,
                                                                                                   result: undefined } }]).value),
                            'grant epoch stale');
    __compactRuntime.assert(g_0.gen
                            ===
                            _descriptor_11.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_8.toValue(13n),
                                                                                                                   alignment: _descriptor_8.alignment() } }] } },
                                                                                        { popeq: { cached: false,
                                                                                                   result: undefined } }]).value),
                            'grant generation stale');
    let tmp_0;
    __compactRuntime.assert(g_0.scope.expires_at === 0n
                            ||
                            (tmp_0 = g_0.scope.expires_at,
                             _descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 2 } },
                                                                                        { idx: { cached: true,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_8.toValue(2n),
                                                                                                                   alignment: _descriptor_8.alignment() } }] } },
                                                                                        { push: { storage: false,
                                                                                                  value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(tmp_0),
                                                                                                                                               alignment: _descriptor_0.alignment() }).encode() } },
                                                                                        'lt',
                                                                                        { popeq: { cached: true,
                                                                                                   result: undefined } }]).value)),
                            'grant expired');
    return [id_0, g_0];
  }
  _check_spend_scope_0(g_0,
                       op_admitted_0,
                       scope_salt_0,
                       obj_color_0,
                       recipient_kind_0,
                       pinned_recipient_0,
                       max_coin_value_0,
                       amount_0,
                       spent_prev_0,
                       this_kind_0,
                       recipient_bytes_0)
  {
    __compactRuntime.assert(op_admitted_0, 'operation not in scope');
    __compactRuntime.assert(this._equal_10(this._derive_grant_object_commit_0(scope_salt_0,
                                                                              obj_color_0,
                                                                              recipient_kind_0,
                                                                              pinned_recipient_0,
                                                                              max_coin_value_0),
                                           g_0.scope.object_commit),
                            'scope object mismatch');
    __compactRuntime.assert(amount_0 <= g_0.scope.per_call_cap,
                            'amount above per-call cap');
    __compactRuntime.assert(this._equal_11(this._derive_grant_spent_commit_0(scope_salt_0,
                                                                             spent_prev_0),
                                           g_0.spent_commit),
                            'spent opening mismatch');
    const wide_0 = spent_prev_0 + amount_0;
    __compactRuntime.assert(wide_0 <= g_0.scope.cap, 'cumulative cap exceeded');
    const new_spent_0 = ((t1) => {
                          if (t1 > 340282366920938463463374607431768211455n) {
                            throw new __compactRuntime.CompactError('account.compact line 1802 char 21: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 340282366920938463463374607431768211455');
                          }
                          return t1;
                        })(wide_0);
    __compactRuntime.assert(recipient_kind_0 === 0n
                            ||
                            recipient_kind_0 === this_kind_0
                            &&
                            this._equal_12(pinned_recipient_0, recipient_bytes_0),
                            'recipient not admitted by pin');
    return new_spent_0;
  }
  async _check_shielded_grant_bounds_0(context,
                                       partialProofData,
                                       coin_0,
                                       max_coin_value_0,
                                       enc_pk_0)
  {
    let t_0;
    __compactRuntime.assert((t_0 = coin_0.value, t_0 <= max_coin_value_0),
                            'coin above max_coin_value');
    __compactRuntime.assert(this._equal_13(enc_pk_0,
                                           _descriptor_1.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                     partialProofData,
                                                                                                     [
                                                                                                      { dup: { n: 0 } },
                                                                                                      { idx: { cached: false,
                                                                                                               pushPath: false,
                                                                                                               path: [
                                                                                                                      { tag: 'value',
                                                                                                                        value: { value: _descriptor_8.toValue(1n),
                                                                                                                                 alignment: _descriptor_8.alignment() } }] } },
                                                                                                      { popeq: { cached: false,
                                                                                                                 result: undefined } }]).value)),
                            'stale encryption key');
    return [];
  }
  async _settle_grant_with_k256_0(context,
                                  partialProofData,
                                  id_0,
                                  g_0,
                                  pk_0,
                                  envelope_0,
                                  challenge_0,
                                  sig_0,
                                  scope_salt_0,
                                  new_spent_0)
  {
    const digest_0 = this._envelope_digest_0(envelope_0, challenge_0);
    __compactRuntime.assert(this._secp256k1EcdsaVerify_0(digest_0, sig_0, pk_0),
                            'invalid grant signature');
    const tmp_0 = { epoch: g_0.epoch,
                    gen: g_0.gen,
                    issued_at: g_0.issued_at,
                    nonce:
                      ((t1) => {
                        if (t1 > 18446744073709551615n) {
                          throw new __compactRuntime.CompactError('account.compact line 1848 char 20: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                        }
                        return t1;
                      })(g_0.nonce + 1n),
                    spent_commit:
                      this._derive_grant_spent_commit_0(scope_salt_0,
                                                        new_spent_0),
                    window_start: g_0.window_start,
                    window_spent: g_0.window_spent,
                    active: g_0.active,
                    scope: g_0.scope };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_8.toValue(12n),
                                                                  alignment: _descriptor_8.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(id_0),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_13.toValue(tmp_0),
                                                                                              alignment: _descriptor_13.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    await this._bump_round_0(context, partialProofData);
    return [];
  }
  async _authenticate_grant_with_jubjub_0(context,
                                          partialProofData,
                                          pk_0,
                                          origin_hash_0,
                                          slot_0)
  {
    __compactRuntime.assert(!this._equal_14(this._ecMul_0(pk_0,
                                                          __compactRuntime.convertNumericToJubjubScalar(8n)),
                                            this._ecMulGenerator_0(__compactRuntime.convertNumericToJubjubScalar(0n))),
                            'grantee key has small order');
    const id_0 = this._derive_grant_id_with_jubjub_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                               partialProofData,
                                                                                                               [
                                                                                                                { dup: { n: 2 } },
                                                                                                                { idx: { cached: true,
                                                                                                                         pushPath: false,
                                                                                                                         path: [
                                                                                                                                { tag: 'value',
                                                                                                                                  value: { value: _descriptor_8.toValue(0n),
                                                                                                                                           alignment: _descriptor_8.alignment() } }] } },
                                                                                                                { popeq: { cached: true,
                                                                                                                           result: undefined } }]).value),
                                                     pk_0,
                                                     origin_hash_0,
                                                     slot_0);
    __compactRuntime.assert(_descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                      partialProofData,
                                                                                      [
                                                                                       { dup: { n: 0 } },
                                                                                       { idx: { cached: false,
                                                                                                pushPath: false,
                                                                                                path: [
                                                                                                       { tag: 'value',
                                                                                                         value: { value: _descriptor_8.toValue(12n),
                                                                                                                  alignment: _descriptor_8.alignment() } }] } },
                                                                                       { push: { storage: false,
                                                                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(id_0),
                                                                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                                                                       'member',
                                                                                       { popeq: { cached: true,
                                                                                                  result: undefined } }]).value),
                            'unknown grant');
    const g_0 = _descriptor_13.fromValue(__compactRuntime.queryLedgerState(context,
                                                                           partialProofData,
                                                                           [
                                                                            { dup: { n: 0 } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_8.toValue(12n),
                                                                                                       alignment: _descriptor_8.alignment() } }] } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_1.toValue(id_0),
                                                                                                       alignment: _descriptor_1.alignment() } }] } },
                                                                            { popeq: { cached: false,
                                                                                       result: undefined } }]).value);
    __compactRuntime.assert(g_0.active, 'grant revoked');
    __compactRuntime.assert(g_0.epoch
                            ===
                            _descriptor_11.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_8.toValue(7n),
                                                                                                                   alignment: _descriptor_8.alignment() } }] } },
                                                                                        { popeq: { cached: false,
                                                                                                   result: undefined } }]).value),
                            'grant epoch stale');
    __compactRuntime.assert(g_0.gen
                            ===
                            _descriptor_11.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_8.toValue(13n),
                                                                                                                   alignment: _descriptor_8.alignment() } }] } },
                                                                                        { popeq: { cached: false,
                                                                                                   result: undefined } }]).value),
                            'grant generation stale');
    let tmp_0;
    __compactRuntime.assert(g_0.scope.expires_at === 0n
                            ||
                            (tmp_0 = g_0.scope.expires_at,
                             _descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 2 } },
                                                                                        { idx: { cached: true,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_8.toValue(2n),
                                                                                                                   alignment: _descriptor_8.alignment() } }] } },
                                                                                        { push: { storage: false,
                                                                                                  value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(tmp_0),
                                                                                                                                               alignment: _descriptor_0.alignment() }).encode() } },
                                                                                        'lt',
                                                                                        { popeq: { cached: true,
                                                                                                   result: undefined } }]).value)),
                            'grant expired');
    return [id_0, g_0];
  }
  async _settle_grant_with_jubjub_0(context,
                                    partialProofData,
                                    id_0,
                                    g_0,
                                    pk_0,
                                    challenge_0,
                                    sig_r_0,
                                    sig_s_0,
                                    scope_salt_0,
                                    new_spent_0)
  {
    const c_0 = __compactRuntime.convertBytesToUint(52435875175126190479447740508185965837690552500527637822603658699938581184512n,
                                                    32,
                                                    challenge_0,
                                                    'Field',
                                                    'account.compact line 1906 char 13');
    __compactRuntime.assert(this._equal_15(this._ecMulGenerator_0(__compactRuntime.convertNumericToJubjubScalar(sig_s_0)),
                                           this._ecAdd_0(sig_r_0,
                                                         this._ecMul_0(pk_0,
                                                                       __compactRuntime.convertNumericToJubjubScalar(c_0)))),
                            'invalid grant signature');
    const tmp_0 = { epoch: g_0.epoch,
                    gen: g_0.gen,
                    issued_at: g_0.issued_at,
                    nonce:
                      ((t1) => {
                        if (t1 > 18446744073709551615n) {
                          throw new __compactRuntime.CompactError('account.compact line 1915 char 20: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                        }
                        return t1;
                      })(g_0.nonce + 1n),
                    spent_commit:
                      this._derive_grant_spent_commit_0(scope_salt_0,
                                                        new_spent_0),
                    window_start: g_0.window_start,
                    window_spent: g_0.window_spent,
                    active: g_0.active,
                    scope: g_0.scope };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_8.toValue(12n),
                                                                  alignment: _descriptor_8.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(id_0),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_13.toValue(tmp_0),
                                                                                              alignment: _descriptor_13.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    await this._bump_round_0(context, partialProofData);
    return [];
  }
  async _withdraw_unshielded_with_grant_k256_0(context,
                                               partialProofData,
                                               color_0,
                                               amount_0,
                                               recipient_0,
                                               pk_0,
                                               envelope_0,
                                               origin_hash_0,
                                               slot_0,
                                               scope_salt_0,
                                               recipient_kind_0,
                                               pinned_recipient_0,
                                               max_coin_value_0,
                                               spent_prev_0,
                                               sig_0)
  {
    const __compact_pattern_tmp7_0 = await this._authenticate_grant_with_k256_0(context,
                                                                                partialProofData,
                                                                                pk_0,
                                                                                envelope_0,
                                                                                origin_hash_0,
                                                                                slot_0);
    const id_0 = __compact_pattern_tmp7_0[0];
    const g_0 = __compact_pattern_tmp7_0[1];
    const new_spent_0 = this._check_spend_scope_0(g_0,
                                                  g_0.scope.op_withdraw_unshielded,
                                                  scope_salt_0,
                                                  color_0,
                                                  recipient_kind_0,
                                                  pinned_recipient_0,
                                                  max_coin_value_0,
                                                  amount_0,
                                                  spent_prev_0,
                                                  1n,
                                                  recipient_0.bytes);
    const challenge_0 = this._challenge_withdraw_unshielded_with_grant_k256_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                        partialProofData,
                                                                                                                                        [
                                                                                                                                         { dup: { n: 2 } },
                                                                                                                                         { idx: { cached: true,
                                                                                                                                                  pushPath: false,
                                                                                                                                                  path: [
                                                                                                                                                         { tag: 'value',
                                                                                                                                                           value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                                    alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                         { popeq: { cached: true,
                                                                                                                                                    result: undefined } }]).value),
                                                                              pk_0,
                                                                              id_0,
                                                                              g_0.issued_at,
                                                                              color_0,
                                                                              amount_0,
                                                                              recipient_0,
                                                                              g_0.nonce);
    await this._settle_grant_with_k256_0(context,
                                         partialProofData,
                                         id_0,
                                         g_0,
                                         pk_0,
                                         envelope_0,
                                         challenge_0,
                                         sig_0,
                                         scope_salt_0,
                                         new_spent_0);
    await this._do_withdraw_unshielded_0(context,
                                         partialProofData,
                                         color_0,
                                         amount_0,
                                         recipient_0);
    return [];
  }
  async _withdraw_shielded_with_grant_k256_0(context,
                                             partialProofData,
                                             recipient_0,
                                             color_0,
                                             amount_0,
                                             change_entry_0,
                                             enc_pk_0,
                                             pk_0,
                                             envelope_0,
                                             origin_hash_0,
                                             slot_0,
                                             scope_salt_0,
                                             recipient_kind_0,
                                             pinned_recipient_0,
                                             max_coin_value_0,
                                             spent_prev_0,
                                             sig_0)
  {
    const coin_0 = this._held_coin_0(context, partialProofData, color_0);
    const __compact_pattern_tmp8_0 = await this._authenticate_grant_with_k256_0(context,
                                                                                partialProofData,
                                                                                pk_0,
                                                                                envelope_0,
                                                                                origin_hash_0,
                                                                                slot_0);
    const id_0 = __compact_pattern_tmp8_0[0];
    const g_0 = __compact_pattern_tmp8_0[1];
    const new_spent_0 = this._check_spend_scope_0(g_0,
                                                  g_0.scope.op_withdraw_shielded,
                                                  scope_salt_0,
                                                  coin_0.color,
                                                  recipient_kind_0,
                                                  pinned_recipient_0,
                                                  max_coin_value_0,
                                                  amount_0,
                                                  spent_prev_0,
                                                  2n,
                                                  recipient_0.bytes);
    await this._check_shielded_grant_bounds_0(context,
                                              partialProofData,
                                              coin_0,
                                              max_coin_value_0,
                                              enc_pk_0);
    const challenge_0 = this._challenge_withdraw_shielded_with_grant_k256_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                      partialProofData,
                                                                                                                                      [
                                                                                                                                       { dup: { n: 2 } },
                                                                                                                                       { idx: { cached: true,
                                                                                                                                                pushPath: false,
                                                                                                                                                path: [
                                                                                                                                                       { tag: 'value',
                                                                                                                                                         value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                                  alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                       { popeq: { cached: true,
                                                                                                                                                  result: undefined } }]).value),
                                                                            pk_0,
                                                                            id_0,
                                                                            g_0.issued_at,
                                                                            recipient_0,
                                                                            color_0,
                                                                            amount_0,
                                                                            change_entry_0,
                                                                            enc_pk_0,
                                                                            coin_0,
                                                                            g_0.nonce);
    await this._settle_grant_with_k256_0(context,
                                         partialProofData,
                                         id_0,
                                         g_0,
                                         pk_0,
                                         envelope_0,
                                         challenge_0,
                                         sig_0,
                                         scope_salt_0,
                                         new_spent_0);
    const result_0 = await this._do_withdraw_shielded_0(context,
                                                        partialProofData,
                                                        recipient_0,
                                                        amount_0,
                                                        coin_0);
    if (result_0.is_some) {
      await this._do_append_inbox_0(context, partialProofData, change_entry_0);
    }
    return result_0;
  }
  async _withdraw_shielded_to_contract_with_grant_k256_0(context,
                                                         partialProofData,
                                                         recipient_0,
                                                         color_0,
                                                         amount_0,
                                                         change_entry_0,
                                                         enc_pk_0,
                                                         pk_0,
                                                         envelope_0,
                                                         origin_hash_0,
                                                         slot_0,
                                                         scope_salt_0,
                                                         recipient_kind_0,
                                                         pinned_recipient_0,
                                                         max_coin_value_0,
                                                         spent_prev_0,
                                                         sig_0)
  {
    const coin_0 = this._held_coin_0(context, partialProofData, color_0);
    const __compact_pattern_tmp5_0 = await this._authenticate_grant_with_k256_0(context,
                                                                                partialProofData,
                                                                                pk_0,
                                                                                envelope_0,
                                                                                origin_hash_0,
                                                                                slot_0);
    const id_0 = __compact_pattern_tmp5_0[0];
    const g_0 = __compact_pattern_tmp5_0[1];
    const new_spent_0 = this._check_spend_scope_0(g_0,
                                                  g_0.scope.op_withdraw_shielded_to_contract,
                                                  scope_salt_0,
                                                  coin_0.color,
                                                  recipient_kind_0,
                                                  pinned_recipient_0,
                                                  max_coin_value_0,
                                                  amount_0,
                                                  spent_prev_0,
                                                  3n,
                                                  recipient_0.bytes);
    await this._check_shielded_grant_bounds_0(context,
                                              partialProofData,
                                              coin_0,
                                              max_coin_value_0,
                                              enc_pk_0);
    const challenge_0 = this._challenge_withdraw_shielded_to_contract_with_grant_k256_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                                  partialProofData,
                                                                                                                                                  [
                                                                                                                                                   { dup: { n: 2 } },
                                                                                                                                                   { idx: { cached: true,
                                                                                                                                                            pushPath: false,
                                                                                                                                                            path: [
                                                                                                                                                                   { tag: 'value',
                                                                                                                                                                     value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                                              alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                                   { popeq: { cached: true,
                                                                                                                                                              result: undefined } }]).value),
                                                                                        pk_0,
                                                                                        id_0,
                                                                                        g_0.issued_at,
                                                                                        recipient_0,
                                                                                        color_0,
                                                                                        amount_0,
                                                                                        change_entry_0,
                                                                                        enc_pk_0,
                                                                                        coin_0,
                                                                                        g_0.nonce);
    await this._settle_grant_with_k256_0(context,
                                         partialProofData,
                                         id_0,
                                         g_0,
                                         pk_0,
                                         envelope_0,
                                         challenge_0,
                                         sig_0,
                                         scope_salt_0,
                                         new_spent_0);
    const __compact_pattern_tmp4_0 = await this._do_withdraw_shielded_to_contract_0(context,
                                                                                    partialProofData,
                                                                                    recipient_0,
                                                                                    amount_0,
                                                                                    coin_0);
    const sent_0 = __compact_pattern_tmp4_0[0];
    const change_0 = __compact_pattern_tmp4_0[1];
    if (change_0.is_some) {
      await this._do_append_inbox_0(context, partialProofData, change_entry_0);
    }
    return [sent_0, change_0];
  }
  async _withdraw_unshielded_with_grant_jubjub_0(context,
                                                 partialProofData,
                                                 color_0,
                                                 amount_0,
                                                 recipient_0,
                                                 pk_0,
                                                 origin_hash_0,
                                                 slot_0,
                                                 scope_salt_0,
                                                 recipient_kind_0,
                                                 pinned_recipient_0,
                                                 max_coin_value_0,
                                                 spent_prev_0,
                                                 sig_r_0,
                                                 sig_s_0,
                                                 grind_nonce_0)
  {
    const __compact_pattern_tmp6_0 = await this._authenticate_grant_with_jubjub_0(context,
                                                                                  partialProofData,
                                                                                  pk_0,
                                                                                  origin_hash_0,
                                                                                  slot_0);
    const id_0 = __compact_pattern_tmp6_0[0];
    const g_0 = __compact_pattern_tmp6_0[1];
    const new_spent_0 = this._check_spend_scope_0(g_0,
                                                  g_0.scope.op_withdraw_unshielded,
                                                  scope_salt_0,
                                                  color_0,
                                                  recipient_kind_0,
                                                  pinned_recipient_0,
                                                  max_coin_value_0,
                                                  amount_0,
                                                  spent_prev_0,
                                                  1n,
                                                  recipient_0.bytes);
    const challenge_0 = this._challenge_withdraw_unshielded_with_grant_jubjub_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                          partialProofData,
                                                                                                                                          [
                                                                                                                                           { dup: { n: 2 } },
                                                                                                                                           { idx: { cached: true,
                                                                                                                                                    pushPath: false,
                                                                                                                                                    path: [
                                                                                                                                                           { tag: 'value',
                                                                                                                                                             value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                                      alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                           { popeq: { cached: true,
                                                                                                                                                      result: undefined } }]).value),
                                                                                sig_r_0,
                                                                                pk_0,
                                                                                id_0,
                                                                                g_0.issued_at,
                                                                                color_0,
                                                                                amount_0,
                                                                                recipient_0,
                                                                                g_0.nonce,
                                                                                grind_nonce_0);
    await this._settle_grant_with_jubjub_0(context,
                                           partialProofData,
                                           id_0,
                                           g_0,
                                           pk_0,
                                           challenge_0,
                                           sig_r_0,
                                           sig_s_0,
                                           scope_salt_0,
                                           new_spent_0);
    await this._do_withdraw_unshielded_0(context,
                                         partialProofData,
                                         color_0,
                                         amount_0,
                                         recipient_0);
    return [];
  }
  async _withdraw_shielded_with_grant_jubjub_0(context,
                                               partialProofData,
                                               recipient_0,
                                               color_0,
                                               amount_0,
                                               change_entry_0,
                                               enc_pk_0,
                                               pk_0,
                                               origin_hash_0,
                                               slot_0,
                                               scope_salt_0,
                                               recipient_kind_0,
                                               pinned_recipient_0,
                                               max_coin_value_0,
                                               spent_prev_0,
                                               sig_r_0,
                                               sig_s_0,
                                               grind_nonce_0)
  {
    const coin_0 = this._held_coin_0(context, partialProofData, color_0);
    const __compact_pattern_tmp1_0 = await this._authenticate_grant_with_jubjub_0(context,
                                                                                  partialProofData,
                                                                                  pk_0,
                                                                                  origin_hash_0,
                                                                                  slot_0);
    const id_0 = __compact_pattern_tmp1_0[0];
    const g_0 = __compact_pattern_tmp1_0[1];
    const new_spent_0 = this._check_spend_scope_0(g_0,
                                                  g_0.scope.op_withdraw_shielded,
                                                  scope_salt_0,
                                                  coin_0.color,
                                                  recipient_kind_0,
                                                  pinned_recipient_0,
                                                  max_coin_value_0,
                                                  amount_0,
                                                  spent_prev_0,
                                                  2n,
                                                  recipient_0.bytes);
    await this._check_shielded_grant_bounds_0(context,
                                              partialProofData,
                                              coin_0,
                                              max_coin_value_0,
                                              enc_pk_0);
    const challenge_0 = this._challenge_withdraw_shielded_with_grant_jubjub_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                        partialProofData,
                                                                                                                                        [
                                                                                                                                         { dup: { n: 2 } },
                                                                                                                                         { idx: { cached: true,
                                                                                                                                                  pushPath: false,
                                                                                                                                                  path: [
                                                                                                                                                         { tag: 'value',
                                                                                                                                                           value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                                    alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                         { popeq: { cached: true,
                                                                                                                                                    result: undefined } }]).value),
                                                                              sig_r_0,
                                                                              pk_0,
                                                                              id_0,
                                                                              g_0.issued_at,
                                                                              recipient_0,
                                                                              color_0,
                                                                              amount_0,
                                                                              change_entry_0,
                                                                              enc_pk_0,
                                                                              coin_0,
                                                                              g_0.nonce,
                                                                              grind_nonce_0);
    await this._settle_grant_with_jubjub_0(context,
                                           partialProofData,
                                           id_0,
                                           g_0,
                                           pk_0,
                                           challenge_0,
                                           sig_r_0,
                                           sig_s_0,
                                           scope_salt_0,
                                           new_spent_0);
    const result_0 = await this._do_withdraw_shielded_0(context,
                                                        partialProofData,
                                                        recipient_0,
                                                        amount_0,
                                                        coin_0);
    if (result_0.is_some) {
      await this._do_append_inbox_0(context, partialProofData, change_entry_0);
    }
    return result_0;
  }
  async _withdraw_shielded_to_contract_with_grant_jubjub_0(context,
                                                           partialProofData,
                                                           recipient_0,
                                                           color_0,
                                                           amount_0,
                                                           change_entry_0,
                                                           enc_pk_0,
                                                           pk_0,
                                                           origin_hash_0,
                                                           slot_0,
                                                           scope_salt_0,
                                                           recipient_kind_0,
                                                           pinned_recipient_0,
                                                           max_coin_value_0,
                                                           spent_prev_0,
                                                           sig_r_0,
                                                           sig_s_0,
                                                           grind_nonce_0)
  {
    const coin_0 = this._held_coin_0(context, partialProofData, color_0);
    const __compact_pattern_tmp3_0 = await this._authenticate_grant_with_jubjub_0(context,
                                                                                  partialProofData,
                                                                                  pk_0,
                                                                                  origin_hash_0,
                                                                                  slot_0);
    const id_0 = __compact_pattern_tmp3_0[0];
    const g_0 = __compact_pattern_tmp3_0[1];
    const new_spent_0 = this._check_spend_scope_0(g_0,
                                                  g_0.scope.op_withdraw_shielded_to_contract,
                                                  scope_salt_0,
                                                  coin_0.color,
                                                  recipient_kind_0,
                                                  pinned_recipient_0,
                                                  max_coin_value_0,
                                                  amount_0,
                                                  spent_prev_0,
                                                  3n,
                                                  recipient_0.bytes);
    await this._check_shielded_grant_bounds_0(context,
                                              partialProofData,
                                              coin_0,
                                              max_coin_value_0,
                                              enc_pk_0);
    const challenge_0 = this._challenge_withdraw_shielded_to_contract_with_grant_jubjub_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                                    partialProofData,
                                                                                                                                                    [
                                                                                                                                                     { dup: { n: 2 } },
                                                                                                                                                     { idx: { cached: true,
                                                                                                                                                              pushPath: false,
                                                                                                                                                              path: [
                                                                                                                                                                     { tag: 'value',
                                                                                                                                                                       value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                                                alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                                     { popeq: { cached: true,
                                                                                                                                                                result: undefined } }]).value),
                                                                                          sig_r_0,
                                                                                          pk_0,
                                                                                          id_0,
                                                                                          g_0.issued_at,
                                                                                          recipient_0,
                                                                                          color_0,
                                                                                          amount_0,
                                                                                          change_entry_0,
                                                                                          enc_pk_0,
                                                                                          coin_0,
                                                                                          g_0.nonce,
                                                                                          grind_nonce_0);
    await this._settle_grant_with_jubjub_0(context,
                                           partialProofData,
                                           id_0,
                                           g_0,
                                           pk_0,
                                           challenge_0,
                                           sig_r_0,
                                           sig_s_0,
                                           scope_salt_0,
                                           new_spent_0);
    const __compact_pattern_tmp2_0 = await this._do_withdraw_shielded_to_contract_0(context,
                                                                                    partialProofData,
                                                                                    recipient_0,
                                                                                    amount_0,
                                                                                    coin_0);
    const sent_0 = __compact_pattern_tmp2_0[0];
    const change_0 = __compact_pattern_tmp2_0[1];
    if (change_0.is_some) {
      await this._do_append_inbox_0(context, partialProofData, change_entry_0);
    }
    return [sent_0, change_0];
  }
  async _do_issue_grant_0(context,
                          partialProofData,
                          grant_id_0,
                          op_withdraw_unshielded_0,
                          op_withdraw_shielded_0,
                          op_withdraw_shielded_to_contract_0,
                          read_0,
                          color_0,
                          recipient_kind_0,
                          recipient_0,
                          max_coin_value_0,
                          per_call_cap_0,
                          cap_0,
                          expires_at_0,
                          rp_id_hash_0,
                          read_pk_hash_0,
                          window_len_0,
                          window_cap_0,
                          scope_salt_0)
  {
    const id_0 = grant_id_0;
    if (_descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                  partialProofData,
                                                                  [
                                                                   { dup: { n: 0 } },
                                                                   { idx: { cached: false,
                                                                            pushPath: false,
                                                                            path: [
                                                                                   { tag: 'value',
                                                                                     value: { value: _descriptor_8.toValue(12n),
                                                                                              alignment: _descriptor_8.alignment() } }] } },
                                                                   { push: { storage: false,
                                                                             value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(id_0),
                                                                                                                          alignment: _descriptor_1.alignment() }).encode() } },
                                                                   'member',
                                                                   { popeq: { cached: true,
                                                                              result: undefined } }]).value))
    {
      const old_0 = _descriptor_13.fromValue(__compactRuntime.queryLedgerState(context,
                                                                               partialProofData,
                                                                               [
                                                                                { dup: { n: 0 } },
                                                                                { idx: { cached: false,
                                                                                         pushPath: false,
                                                                                         path: [
                                                                                                { tag: 'value',
                                                                                                  value: { value: _descriptor_8.toValue(12n),
                                                                                                           alignment: _descriptor_8.alignment() } }] } },
                                                                                { idx: { cached: false,
                                                                                         pushPath: false,
                                                                                         path: [
                                                                                                { tag: 'value',
                                                                                                  value: { value: _descriptor_1.toValue(id_0),
                                                                                                           alignment: _descriptor_1.alignment() } }] } },
                                                                                { popeq: { cached: false,
                                                                                           result: undefined } }]).value);
      __compactRuntime.assert(!old_0.active
                              ||
                              old_0.epoch
                              !==
                              _descriptor_11.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                         partialProofData,
                                                                                         [
                                                                                          { dup: { n: 0 } },
                                                                                          { idx: { cached: false,
                                                                                                   pushPath: false,
                                                                                                   path: [
                                                                                                          { tag: 'value',
                                                                                                            value: { value: _descriptor_8.toValue(7n),
                                                                                                                     alignment: _descriptor_8.alignment() } }] } },
                                                                                          { popeq: { cached: false,
                                                                                                     result: undefined } }]).value)
                              ||
                              old_0.gen
                              !==
                              _descriptor_11.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                         partialProofData,
                                                                                         [
                                                                                          { dup: { n: 0 } },
                                                                                          { idx: { cached: false,
                                                                                                   pushPath: false,
                                                                                                   path: [
                                                                                                          { tag: 'value',
                                                                                                            value: { value: _descriptor_8.toValue(13n),
                                                                                                                     alignment: _descriptor_8.alignment() } }] } },
                                                                                          { popeq: { cached: false,
                                                                                                     result: undefined } }]).value),
                              'grant already active');
    }
    const spend_0 = op_withdraw_unshielded_0 || op_withdraw_shielded_0
                    ||
                    op_withdraw_shielded_to_contract_0;
    __compactRuntime.assert(spend_0 || read_0, 'empty scope');
    __compactRuntime.assert(!(op_withdraw_shielded_0
                              ||
                              op_withdraw_shielded_to_contract_0)
                            ||
                            read_0,
                            'shielded spend requires read');
    __compactRuntime.assert(per_call_cap_0 <= cap_0, 'per-call cap above cap');
    __compactRuntime.assert(!spend_0 || cap_0 > 0n, 'spend without cap');
    __compactRuntime.assert(!spend_0 || max_coin_value_0 >= per_call_cap_0,
                            'coin bound below per-call cap');
    __compactRuntime.assert(!read_0
                            ||
                            !this._equal_16(read_pk_hash_0,
                                            new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
                            'read without delegate key');
    __compactRuntime.assert(window_len_0 === 0n && window_cap_0 === 0n,
                            'window bounds reserved');
    __compactRuntime.assert(spend_0
                            ||
                            this._equal_17(color_0,
                                           new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
                            &&
                            recipient_kind_0 === 0n
                            &&
                            this._equal_18(recipient_0,
                                           new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
                            &&
                            max_coin_value_0 === 0n
                            &&
                            per_call_cap_0 === 0n
                            &&
                            cap_0 === 0n,
                            'read-only grant carries object fields');
    const tmp_0 = { epoch:
                      _descriptor_11.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                 partialProofData,
                                                                                 [
                                                                                  { dup: { n: 0 } },
                                                                                  { idx: { cached: false,
                                                                                           pushPath: false,
                                                                                           path: [
                                                                                                  { tag: 'value',
                                                                                                    value: { value: _descriptor_8.toValue(7n),
                                                                                                             alignment: _descriptor_8.alignment() } }] } },
                                                                                  { popeq: { cached: false,
                                                                                             result: undefined } }]).value),
                    gen:
                      _descriptor_11.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                 partialProofData,
                                                                                 [
                                                                                  { dup: { n: 0 } },
                                                                                  { idx: { cached: false,
                                                                                           pushPath: false,
                                                                                           path: [
                                                                                                  { tag: 'value',
                                                                                                    value: { value: _descriptor_8.toValue(13n),
                                                                                                             alignment: _descriptor_8.alignment() } }] } },
                                                                                  { popeq: { cached: false,
                                                                                             result: undefined } }]).value),
                    issued_at:
                      _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                partialProofData,
                                                                                [
                                                                                 { dup: { n: 0 } },
                                                                                 { idx: { cached: false,
                                                                                          pushPath: false,
                                                                                          path: [
                                                                                                 { tag: 'value',
                                                                                                   value: { value: _descriptor_8.toValue(9n),
                                                                                                            alignment: _descriptor_8.alignment() } }] } },
                                                                                 { popeq: { cached: false,
                                                                                            result: undefined } }]).value),
                    nonce: 0n,
                    spent_commit:
                      this._derive_grant_spent_commit_0(scope_salt_0, 0n),
                    window_start: 0n,
                    window_spent: 0n,
                    active: true,
                    scope:
                      { op_withdraw_unshielded: op_withdraw_unshielded_0,
                        op_withdraw_shielded: op_withdraw_shielded_0,
                        op_withdraw_shielded_to_contract:
                          op_withdraw_shielded_to_contract_0,
                        read: read_0,
                        object_commit:
                          this._derive_grant_object_commit_0(scope_salt_0,
                                                             color_0,
                                                             recipient_kind_0,
                                                             recipient_0,
                                                             max_coin_value_0),
                        per_call_cap: per_call_cap_0,
                        cap: cap_0,
                        expires_at: expires_at_0,
                        rp_commit:
                          this._derive_grant_rp_commit_0(scope_salt_0,
                                                         rp_id_hash_0),
                        read_pk_hash: read_pk_hash_0,
                        window_len: 0n,
                        window_cap: 0n } };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_8.toValue(12n),
                                                                  alignment: _descriptor_8.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(id_0),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_13.toValue(tmp_0),
                                                                                              alignment: _descriptor_13.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  async _do_revoke_grant_0(context, partialProofData, grant_id_0) {
    const id_0 = grant_id_0;
    __compactRuntime.assert(_descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                      partialProofData,
                                                                                      [
                                                                                       { dup: { n: 0 } },
                                                                                       { idx: { cached: false,
                                                                                                pushPath: false,
                                                                                                path: [
                                                                                                       { tag: 'value',
                                                                                                         value: { value: _descriptor_8.toValue(12n),
                                                                                                                  alignment: _descriptor_8.alignment() } }] } },
                                                                                       { push: { storage: false,
                                                                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(id_0),
                                                                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                                                                       'member',
                                                                                       { popeq: { cached: true,
                                                                                                  result: undefined } }]).value),
                            'unknown grant');
    const old_0 = _descriptor_13.fromValue(__compactRuntime.queryLedgerState(context,
                                                                             partialProofData,
                                                                             [
                                                                              { dup: { n: 0 } },
                                                                              { idx: { cached: false,
                                                                                       pushPath: false,
                                                                                       path: [
                                                                                              { tag: 'value',
                                                                                                value: { value: _descriptor_8.toValue(12n),
                                                                                                         alignment: _descriptor_8.alignment() } }] } },
                                                                              { idx: { cached: false,
                                                                                       pushPath: false,
                                                                                       path: [
                                                                                              { tag: 'value',
                                                                                                value: { value: _descriptor_1.toValue(id_0),
                                                                                                         alignment: _descriptor_1.alignment() } }] } },
                                                                              { popeq: { cached: false,
                                                                                         result: undefined } }]).value);
    __compactRuntime.assert(old_0.active, 'grant not live');
    const tmp_0 = { epoch: old_0.epoch,
                    gen: old_0.gen,
                    issued_at: old_0.issued_at,
                    nonce: old_0.nonce,
                    spent_commit: old_0.spent_commit,
                    window_start: old_0.window_start,
                    window_spent: old_0.window_spent,
                    active: false,
                    scope: old_0.scope };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_8.toValue(12n),
                                                                  alignment: _descriptor_8.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(id_0),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_13.toValue(tmp_0),
                                                                                              alignment: _descriptor_13.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  async _do_revoke_all_grants_0(context, partialProofData) {
    const tmp_0 = ((t1) => {
                    if (t1 > 4294967295n) {
                      throw new __compactRuntime.CompactError('account.compact line 2257 char 23: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 4294967295');
                    }
                    return t1;
                  })(_descriptor_11.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                partialProofData,
                                                                                [
                                                                                 { dup: { n: 0 } },
                                                                                 { idx: { cached: false,
                                                                                          pushPath: false,
                                                                                          path: [
                                                                                                 { tag: 'value',
                                                                                                   value: { value: _descriptor_8.toValue(13n),
                                                                                                            alignment: _descriptor_8.alignment() } }] } },
                                                                                 { popeq: { cached: false,
                                                                                            result: undefined } }]).value)
                     +
                     1n);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(13n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_11.toValue(tmp_0),
                                                                                              alignment: _descriptor_11.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(12n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newMap(
                                                          new __compactRuntime.StateMap()
                                                        ).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    return [];
  }
  async _issue_grant_with_k256_0(context,
                                 partialProofData,
                                 grant_id_0,
                                 op_withdraw_unshielded_0,
                                 op_withdraw_shielded_0,
                                 op_withdraw_shielded_to_contract_0,
                                 read_0,
                                 color_0,
                                 recipient_kind_0,
                                 recipient_0,
                                 max_coin_value_0,
                                 per_call_cap_0,
                                 cap_0,
                                 expires_at_0,
                                 rp_id_hash_0,
                                 read_pk_hash_0,
                                 window_len_0,
                                 window_cap_0,
                                 scope_salt_0,
                                 pk_0,
                                 use_counter_0,
                                 sig_0,
                                 envelope_0)
  {
    const scope_digest_0 = this._derive_grant_scope_digest_0(scope_salt_0,
                                                             op_withdraw_unshielded_0,
                                                             op_withdraw_shielded_0,
                                                             op_withdraw_shielded_to_contract_0,
                                                             read_0,
                                                             color_0,
                                                             recipient_kind_0,
                                                             recipient_0,
                                                             max_coin_value_0,
                                                             per_call_cap_0,
                                                             cap_0,
                                                             expires_at_0,
                                                             rp_id_hash_0,
                                                             read_pk_hash_0,
                                                             window_len_0,
                                                             window_cap_0);
    const challenge_0 = this._challenge_issue_grant_with_k256_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 2 } },
                                                                                                                           { idx: { cached: true,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                      alignment: _descriptor_8.alignment() } }] } },
                                                                                                                           { popeq: { cached: true,
                                                                                                                                      result: undefined } }]).value),
                                                                pk_0,
                                                                grant_id_0,
                                                                scope_digest_0,
                                                                _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 0 } },
                                                                                                                           { idx: { cached: false,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_8.toValue(9n),
                                                                                                                                                      alignment: _descriptor_8.alignment() } }] } },
                                                                                                                           { popeq: { cached: false,
                                                                                                                                      result: undefined } }]).value));
    await this._require_authorised_with_k256_0(context,
                                               partialProofData,
                                               pk_0,
                                               use_counter_0,
                                               sig_0,
                                               challenge_0,
                                               envelope_0);
    await this._do_issue_grant_0(context,
                                 partialProofData,
                                 grant_id_0,
                                 op_withdraw_unshielded_0,
                                 op_withdraw_shielded_0,
                                 op_withdraw_shielded_to_contract_0,
                                 read_0,
                                 color_0,
                                 recipient_kind_0,
                                 recipient_0,
                                 max_coin_value_0,
                                 per_call_cap_0,
                                 cap_0,
                                 expires_at_0,
                                 rp_id_hash_0,
                                 read_pk_hash_0,
                                 window_len_0,
                                 window_cap_0,
                                 scope_salt_0);
    return [];
  }
  async _revoke_grant_with_k256_0(context,
                                  partialProofData,
                                  grant_id_0,
                                  pk_0,
                                  use_counter_0,
                                  sig_0,
                                  envelope_0)
  {
    const challenge_0 = this._challenge_revoke_grant_with_k256_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                           partialProofData,
                                                                                                                           [
                                                                                                                            { dup: { n: 2 } },
                                                                                                                            { idx: { cached: true,
                                                                                                                                     pushPath: false,
                                                                                                                                     path: [
                                                                                                                                            { tag: 'value',
                                                                                                                                              value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                       alignment: _descriptor_8.alignment() } }] } },
                                                                                                                            { popeq: { cached: true,
                                                                                                                                       result: undefined } }]).value),
                                                                 pk_0,
                                                                 grant_id_0,
                                                                 _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                           partialProofData,
                                                                                                                           [
                                                                                                                            { dup: { n: 0 } },
                                                                                                                            { idx: { cached: false,
                                                                                                                                     pushPath: false,
                                                                                                                                     path: [
                                                                                                                                            { tag: 'value',
                                                                                                                                              value: { value: _descriptor_8.toValue(9n),
                                                                                                                                                       alignment: _descriptor_8.alignment() } }] } },
                                                                                                                            { popeq: { cached: false,
                                                                                                                                       result: undefined } }]).value));
    await this._require_authorised_with_k256_0(context,
                                               partialProofData,
                                               pk_0,
                                               use_counter_0,
                                               sig_0,
                                               challenge_0,
                                               envelope_0);
    await this._do_revoke_grant_0(context, partialProofData, grant_id_0);
    return [];
  }
  async _revoke_all_grants_with_k256_0(context,
                                       partialProofData,
                                       pk_0,
                                       use_counter_0,
                                       sig_0,
                                       envelope_0)
  {
    const challenge_0 = this._challenge_revoke_all_grants_with_k256_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                partialProofData,
                                                                                                                                [
                                                                                                                                 { dup: { n: 2 } },
                                                                                                                                 { idx: { cached: true,
                                                                                                                                          pushPath: false,
                                                                                                                                          path: [
                                                                                                                                                 { tag: 'value',
                                                                                                                                                   value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                            alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                 { popeq: { cached: true,
                                                                                                                                            result: undefined } }]).value),
                                                                      pk_0,
                                                                      _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                partialProofData,
                                                                                                                                [
                                                                                                                                 { dup: { n: 0 } },
                                                                                                                                 { idx: { cached: false,
                                                                                                                                          pushPath: false,
                                                                                                                                          path: [
                                                                                                                                                 { tag: 'value',
                                                                                                                                                   value: { value: _descriptor_8.toValue(9n),
                                                                                                                                                            alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                 { popeq: { cached: false,
                                                                                                                                            result: undefined } }]).value));
    await this._require_authorised_with_k256_0(context,
                                               partialProofData,
                                               pk_0,
                                               use_counter_0,
                                               sig_0,
                                               challenge_0,
                                               envelope_0);
    await this._do_revoke_all_grants_0(context, partialProofData);
    return [];
  }
  async _issue_grant_with_jubjub_0(context,
                                   partialProofData,
                                   grant_id_0,
                                   op_withdraw_unshielded_0,
                                   op_withdraw_shielded_0,
                                   op_withdraw_shielded_to_contract_0,
                                   read_0,
                                   color_0,
                                   recipient_kind_0,
                                   recipient_0,
                                   max_coin_value_0,
                                   per_call_cap_0,
                                   cap_0,
                                   expires_at_0,
                                   rp_id_hash_0,
                                   read_pk_hash_0,
                                   window_len_0,
                                   window_cap_0,
                                   scope_salt_0,
                                   pk_0,
                                   use_counter_0,
                                   sig_r_0,
                                   sig_s_0,
                                   grind_nonce_0)
  {
    const scope_digest_0 = this._derive_grant_scope_digest_0(scope_salt_0,
                                                             op_withdraw_unshielded_0,
                                                             op_withdraw_shielded_0,
                                                             op_withdraw_shielded_to_contract_0,
                                                             read_0,
                                                             color_0,
                                                             recipient_kind_0,
                                                             recipient_0,
                                                             max_coin_value_0,
                                                             per_call_cap_0,
                                                             cap_0,
                                                             expires_at_0,
                                                             rp_id_hash_0,
                                                             read_pk_hash_0,
                                                             window_len_0,
                                                             window_cap_0);
    const challenge_0 = this._challenge_issue_grant_with_jubjub_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                            partialProofData,
                                                                                                                            [
                                                                                                                             { dup: { n: 2 } },
                                                                                                                             { idx: { cached: true,
                                                                                                                                      pushPath: false,
                                                                                                                                      path: [
                                                                                                                                             { tag: 'value',
                                                                                                                                               value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                        alignment: _descriptor_8.alignment() } }] } },
                                                                                                                             { popeq: { cached: true,
                                                                                                                                        result: undefined } }]).value),
                                                                  sig_r_0,
                                                                  pk_0,
                                                                  grant_id_0,
                                                                  scope_digest_0,
                                                                  _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                            partialProofData,
                                                                                                                            [
                                                                                                                             { dup: { n: 0 } },
                                                                                                                             { idx: { cached: false,
                                                                                                                                      pushPath: false,
                                                                                                                                      path: [
                                                                                                                                             { tag: 'value',
                                                                                                                                               value: { value: _descriptor_8.toValue(9n),
                                                                                                                                                        alignment: _descriptor_8.alignment() } }] } },
                                                                                                                             { popeq: { cached: false,
                                                                                                                                        result: undefined } }]).value),
                                                                  grind_nonce_0);
    await this._require_authorised_with_jubjub_0(context,
                                                 partialProofData,
                                                 pk_0,
                                                 use_counter_0,
                                                 sig_r_0,
                                                 sig_s_0,
                                                 challenge_0);
    await this._do_issue_grant_0(context,
                                 partialProofData,
                                 grant_id_0,
                                 op_withdraw_unshielded_0,
                                 op_withdraw_shielded_0,
                                 op_withdraw_shielded_to_contract_0,
                                 read_0,
                                 color_0,
                                 recipient_kind_0,
                                 recipient_0,
                                 max_coin_value_0,
                                 per_call_cap_0,
                                 cap_0,
                                 expires_at_0,
                                 rp_id_hash_0,
                                 read_pk_hash_0,
                                 window_len_0,
                                 window_cap_0,
                                 scope_salt_0);
    return [];
  }
  async _revoke_grant_with_jubjub_0(context,
                                    partialProofData,
                                    grant_id_0,
                                    pk_0,
                                    use_counter_0,
                                    sig_r_0,
                                    sig_s_0,
                                    grind_nonce_0)
  {
    const challenge_0 = this._challenge_revoke_grant_with_jubjub_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                             partialProofData,
                                                                                                                             [
                                                                                                                              { dup: { n: 2 } },
                                                                                                                              { idx: { cached: true,
                                                                                                                                       pushPath: false,
                                                                                                                                       path: [
                                                                                                                                              { tag: 'value',
                                                                                                                                                value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                         alignment: _descriptor_8.alignment() } }] } },
                                                                                                                              { popeq: { cached: true,
                                                                                                                                         result: undefined } }]).value),
                                                                   sig_r_0,
                                                                   pk_0,
                                                                   grant_id_0,
                                                                   _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                             partialProofData,
                                                                                                                             [
                                                                                                                              { dup: { n: 0 } },
                                                                                                                              { idx: { cached: false,
                                                                                                                                       pushPath: false,
                                                                                                                                       path: [
                                                                                                                                              { tag: 'value',
                                                                                                                                                value: { value: _descriptor_8.toValue(9n),
                                                                                                                                                         alignment: _descriptor_8.alignment() } }] } },
                                                                                                                              { popeq: { cached: false,
                                                                                                                                         result: undefined } }]).value),
                                                                   grind_nonce_0);
    await this._require_authorised_with_jubjub_0(context,
                                                 partialProofData,
                                                 pk_0,
                                                 use_counter_0,
                                                 sig_r_0,
                                                 sig_s_0,
                                                 challenge_0);
    await this._do_revoke_grant_0(context, partialProofData, grant_id_0);
    return [];
  }
  async _revoke_all_grants_with_jubjub_0(context,
                                         partialProofData,
                                         pk_0,
                                         use_counter_0,
                                         sig_r_0,
                                         sig_s_0,
                                         grind_nonce_0)
  {
    const challenge_0 = this._challenge_revoke_all_grants_with_jubjub_0(_descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                  partialProofData,
                                                                                                                                  [
                                                                                                                                   { dup: { n: 2 } },
                                                                                                                                   { idx: { cached: true,
                                                                                                                                            pushPath: false,
                                                                                                                                            path: [
                                                                                                                                                   { tag: 'value',
                                                                                                                                                     value: { value: _descriptor_8.toValue(0n),
                                                                                                                                                              alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                   { popeq: { cached: true,
                                                                                                                                              result: undefined } }]).value),
                                                                        sig_r_0,
                                                                        pk_0,
                                                                        _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                  partialProofData,
                                                                                                                                  [
                                                                                                                                   { dup: { n: 0 } },
                                                                                                                                   { idx: { cached: false,
                                                                                                                                            pushPath: false,
                                                                                                                                            path: [
                                                                                                                                                   { tag: 'value',
                                                                                                                                                     value: { value: _descriptor_8.toValue(9n),
                                                                                                                                                              alignment: _descriptor_8.alignment() } }] } },
                                                                                                                                   { popeq: { cached: false,
                                                                                                                                              result: undefined } }]).value),
                                                                        grind_nonce_0);
    await this._require_authorised_with_jubjub_0(context,
                                                 partialProofData,
                                                 pk_0,
                                                 use_counter_0,
                                                 sig_r_0,
                                                 sig_s_0,
                                                 challenge_0);
    await this._do_revoke_all_grants_0(context, partialProofData);
    return [];
  }
  _equal_0(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_1(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_2(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  _equal_3(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_4(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_5(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_6(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_7(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  _equal_8(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  _equal_9(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_10(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_11(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_12(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_13(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_14(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  _equal_15(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  _equal_16(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_17(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_18(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
}
export function ledger(stateOrChargedState) {
  const state = stateOrChargedState instanceof __compactRuntime.StateValue ? stateOrChargedState : stateOrChargedState.state;
  const chargedState = stateOrChargedState instanceof __compactRuntime.StateValue ? new __compactRuntime.ChargedState(stateOrChargedState) : stateOrChargedState;
  const context = {
    callContext: { currentQueryContext: new __compactRuntime.QueryContext(chargedState, __compactRuntime.dummyContractAddress()), currentGasCost: __compactRuntime.emptyRunningCost() },
    costModel: __compactRuntime.CostModel.initialCostModel()
  };
  const partialProofData = {
    input: { value: [], alignment: [] },
    output: undefined,
    publicTranscript: [],
    privateTranscriptOutputs: []
  };
  return {
    get round() {
      return _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_8.toValue(0n),
                                                                                                   alignment: _descriptor_8.alignment() } }] } },
                                                                        { popeq: { cached: false,
                                                                                   result: undefined } }]).value);
    },
    get enc_key() {
      return _descriptor_1.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_8.toValue(1n),
                                                                                                   alignment: _descriptor_8.alignment() } }] } },
                                                                        { popeq: { cached: false,
                                                                                   result: undefined } }]).value);
    },
    inbox: {
      isEmpty(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`isEmpty: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_8.toValue(2n),
                                                                                                     alignment: _descriptor_8.alignment() } }] } },
                                                                          'size',
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(0n),
                                                                                                                                 alignment: _descriptor_0.alignment() }).encode() } },
                                                                          'eq',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      size(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`size: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_8.toValue(2n),
                                                                                                     alignment: _descriptor_8.alignment() } }] } },
                                                                          'size',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      member(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`member: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(typeof(key_0) === 'bigint' && key_0 >= 0n && key_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('member',
                                     'argument 1',
                                     'account.compact line 184 char 1',
                                     'Uint<0..18446744073709551616>',
                                     key_0)
        }
        return _descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_8.toValue(2n),
                                                                                                     alignment: _descriptor_8.alignment() } }] } },
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(key_0),
                                                                                                                                 alignment: _descriptor_0.alignment() }).encode() } },
                                                                          'member',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      lookup(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`lookup: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(typeof(key_0) === 'bigint' && key_0 >= 0n && key_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('lookup',
                                     'argument 1',
                                     'account.compact line 184 char 1',
                                     'Uint<0..18446744073709551616>',
                                     key_0)
        }
        return _descriptor_14.fromValue(__compactRuntime.queryLedgerState(context,
                                                                          partialProofData,
                                                                          [
                                                                           { dup: { n: 0 } },
                                                                           { idx: { cached: false,
                                                                                    pushPath: false,
                                                                                    path: [
                                                                                           { tag: 'value',
                                                                                             value: { value: _descriptor_8.toValue(2n),
                                                                                                      alignment: _descriptor_8.alignment() } }] } },
                                                                           { idx: { cached: false,
                                                                                    pushPath: false,
                                                                                    path: [
                                                                                           { tag: 'value',
                                                                                             value: { value: _descriptor_0.toValue(key_0),
                                                                                                      alignment: _descriptor_0.alignment() } }] } },
                                                                           { popeq: { cached: false,
                                                                                      result: undefined } }]).value);
      },
      [Symbol.iterator](...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`iter: expected 0 arguments, received ${args_0.length}`);
        }
        const self_0 = state.asArray()[2];
        return self_0.asMap().keys().map(  (key) => {    const value = self_0.asMap().get(key).asCell();    return [      _descriptor_0.fromValue(key.value),      _descriptor_14.fromValue(value.value)    ];  })[Symbol.iterator]();
      }
    },
    get inbox_count() {
      return _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_8.toValue(3n),
                                                                                                   alignment: _descriptor_8.alignment() } }] } },
                                                                        { popeq: { cached: false,
                                                                                   result: undefined } }]).value);
    },
    unshielded_balances: {
      isEmpty(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`isEmpty: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_8.toValue(4n),
                                                                                                     alignment: _descriptor_8.alignment() } }] } },
                                                                          'size',
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(0n),
                                                                                                                                 alignment: _descriptor_0.alignment() }).encode() } },
                                                                          'eq',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      size(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`size: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_8.toValue(4n),
                                                                                                     alignment: _descriptor_8.alignment() } }] } },
                                                                          'size',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      member(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`member: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(key_0.buffer instanceof ArrayBuffer && key_0.BYTES_PER_ELEMENT === 1 && key_0.length === 32)) {
          __compactRuntime.typeError('member',
                                     'argument 1',
                                     'account.compact line 189 char 1',
                                     'Bytes<32>',
                                     key_0)
        }
        return _descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_8.toValue(4n),
                                                                                                     alignment: _descriptor_8.alignment() } }] } },
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(key_0),
                                                                                                                                 alignment: _descriptor_1.alignment() }).encode() } },
                                                                          'member',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      lookup(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`lookup: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(key_0.buffer instanceof ArrayBuffer && key_0.BYTES_PER_ELEMENT === 1 && key_0.length === 32)) {
          __compactRuntime.typeError('lookup',
                                     'argument 1',
                                     'account.compact line 189 char 1',
                                     'Bytes<32>',
                                     key_0)
        }
        return _descriptor_10.fromValue(__compactRuntime.queryLedgerState(context,
                                                                          partialProofData,
                                                                          [
                                                                           { dup: { n: 0 } },
                                                                           { idx: { cached: false,
                                                                                    pushPath: false,
                                                                                    path: [
                                                                                           { tag: 'value',
                                                                                             value: { value: _descriptor_8.toValue(4n),
                                                                                                      alignment: _descriptor_8.alignment() } }] } },
                                                                           { idx: { cached: false,
                                                                                    pushPath: false,
                                                                                    path: [
                                                                                           { tag: 'value',
                                                                                             value: { value: _descriptor_1.toValue(key_0),
                                                                                                      alignment: _descriptor_1.alignment() } }] } },
                                                                           { popeq: { cached: false,
                                                                                      result: undefined } }]).value);
      },
      [Symbol.iterator](...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`iter: expected 0 arguments, received ${args_0.length}`);
        }
        const self_0 = state.asArray()[4];
        return self_0.asMap().keys().map(  (key) => {    const value = self_0.asMap().get(key).asCell();    return [      _descriptor_1.fromValue(key.value),      _descriptor_10.fromValue(value.value)    ];  })[Symbol.iterator]();
      }
    },
    get spec_version() {
      return _descriptor_11.fromValue(__compactRuntime.queryLedgerState(context,
                                                                        partialProofData,
                                                                        [
                                                                         { dup: { n: 0 } },
                                                                         { idx: { cached: false,
                                                                                  pushPath: false,
                                                                                  path: [
                                                                                         { tag: 'value',
                                                                                           value: { value: _descriptor_8.toValue(5n),
                                                                                                    alignment: _descriptor_8.alignment() } }] } },
                                                                         { popeq: { cached: false,
                                                                                    result: undefined } }]).value);
    },
    devices: {
      isEmpty(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`isEmpty: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_8.toValue(6n),
                                                                                                     alignment: _descriptor_8.alignment() } }] } },
                                                                          'size',
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(0n),
                                                                                                                                 alignment: _descriptor_0.alignment() }).encode() } },
                                                                          'eq',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      size(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`size: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_8.toValue(6n),
                                                                                                     alignment: _descriptor_8.alignment() } }] } },
                                                                          'size',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      member(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`member: expected 1 argument, received ${args_0.length}`);
        }
        const elem_0 = args_0[0];
        if (!(elem_0.buffer instanceof ArrayBuffer && elem_0.BYTES_PER_ELEMENT === 1 && elem_0.length === 32)) {
          __compactRuntime.typeError('member',
                                     'argument 1',
                                     'account.compact line 198 char 1',
                                     'Bytes<32>',
                                     elem_0)
        }
        return _descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_8.toValue(6n),
                                                                                                     alignment: _descriptor_8.alignment() } }] } },
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(elem_0),
                                                                                                                                 alignment: _descriptor_1.alignment() }).encode() } },
                                                                          'member',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      [Symbol.iterator](...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`iter: expected 0 arguments, received ${args_0.length}`);
        }
        const self_0 = state.asArray()[6];
        return self_0.asMap().keys().map((elem) => _descriptor_1.fromValue(elem.value))[Symbol.iterator]();
      }
    },
    get device_epoch() {
      return _descriptor_11.fromValue(__compactRuntime.queryLedgerState(context,
                                                                        partialProofData,
                                                                        [
                                                                         { dup: { n: 0 } },
                                                                         { idx: { cached: false,
                                                                                  pushPath: false,
                                                                                  path: [
                                                                                         { tag: 'value',
                                                                                           value: { value: _descriptor_8.toValue(7n),
                                                                                                    alignment: _descriptor_8.alignment() } }] } },
                                                                         { popeq: { cached: false,
                                                                                    result: undefined } }]).value);
    },
    get device_count() {
      return _descriptor_8.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_8.toValue(8n),
                                                                                                   alignment: _descriptor_8.alignment() } }] } },
                                                                        { popeq: { cached: false,
                                                                                   result: undefined } }]).value);
    },
    get auth_nonce() {
      return _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_8.toValue(9n),
                                                                                                   alignment: _descriptor_8.alignment() } }] } },
                                                                        { popeq: { cached: false,
                                                                                   result: undefined } }]).value);
    },
    get boot() {
      return _descriptor_1.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_8.toValue(10n),
                                                                                                   alignment: _descriptor_8.alignment() } }] } },
                                                                        { popeq: { cached: false,
                                                                                   result: undefined } }]).value);
    },
    get booted() {
      return _descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_8.toValue(11n),
                                                                                                   alignment: _descriptor_8.alignment() } }] } },
                                                                        { popeq: { cached: false,
                                                                                   result: undefined } }]).value);
    },
    grants: {
      isEmpty(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`isEmpty: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_8.toValue(12n),
                                                                                                     alignment: _descriptor_8.alignment() } }] } },
                                                                          'size',
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(0n),
                                                                                                                                 alignment: _descriptor_0.alignment() }).encode() } },
                                                                          'eq',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      size(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`size: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_8.toValue(12n),
                                                                                                     alignment: _descriptor_8.alignment() } }] } },
                                                                          'size',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      member(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`member: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(key_0.buffer instanceof ArrayBuffer && key_0.BYTES_PER_ELEMENT === 1 && key_0.length === 32)) {
          __compactRuntime.typeError('member',
                                     'argument 1',
                                     'account.compact line 274 char 1',
                                     'Bytes<32>',
                                     key_0)
        }
        return _descriptor_9.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_8.toValue(12n),
                                                                                                     alignment: _descriptor_8.alignment() } }] } },
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(key_0),
                                                                                                                                 alignment: _descriptor_1.alignment() }).encode() } },
                                                                          'member',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      lookup(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`lookup: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(key_0.buffer instanceof ArrayBuffer && key_0.BYTES_PER_ELEMENT === 1 && key_0.length === 32)) {
          __compactRuntime.typeError('lookup',
                                     'argument 1',
                                     'account.compact line 274 char 1',
                                     'Bytes<32>',
                                     key_0)
        }
        return _descriptor_13.fromValue(__compactRuntime.queryLedgerState(context,
                                                                          partialProofData,
                                                                          [
                                                                           { dup: { n: 0 } },
                                                                           { idx: { cached: false,
                                                                                    pushPath: false,
                                                                                    path: [
                                                                                           { tag: 'value',
                                                                                             value: { value: _descriptor_8.toValue(12n),
                                                                                                      alignment: _descriptor_8.alignment() } }] } },
                                                                           { idx: { cached: false,
                                                                                    pushPath: false,
                                                                                    path: [
                                                                                           { tag: 'value',
                                                                                             value: { value: _descriptor_1.toValue(key_0),
                                                                                                      alignment: _descriptor_1.alignment() } }] } },
                                                                           { popeq: { cached: false,
                                                                                      result: undefined } }]).value);
      },
      [Symbol.iterator](...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`iter: expected 0 arguments, received ${args_0.length}`);
        }
        const self_0 = state.asArray()[12];
        return self_0.asMap().keys().map(  (key) => {    const value = self_0.asMap().get(key).asCell();    return [      _descriptor_1.fromValue(key.value),      _descriptor_13.fromValue(value.value)    ];  })[Symbol.iterator]();
      }
    },
    get grant_generation() {
      return _descriptor_11.fromValue(__compactRuntime.queryLedgerState(context,
                                                                        partialProofData,
                                                                        [
                                                                         { dup: { n: 0 } },
                                                                         { idx: { cached: false,
                                                                                  pushPath: false,
                                                                                  path: [
                                                                                         { tag: 'value',
                                                                                           value: { value: _descriptor_8.toValue(13n),
                                                                                                    alignment: _descriptor_8.alignment() } }] } },
                                                                         { popeq: { cached: false,
                                                                                    result: undefined } }]).value);
    }
  };
}
const _emptyContext = {
  callContext: { currentQueryContext: new __compactRuntime.QueryContext(new __compactRuntime.ContractState().data, __compactRuntime.dummyContractAddress()), currentGasCost: __compactRuntime.emptyRunningCost() }
};
const _dummyContract = new Contract({ held_coin: (...args) => undefined });
export const pureCircuits = {
  derive_boot_commitment_with_jubjub: (...args_0) => {
    if (args_0.length !== 2) {
      throw new __compactRuntime.CompactError(`derive_boot_commitment_with_jubjub: expected 2 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const salt_0 = args_0[0];
    const pk_0 = args_0[1];
    if (!(salt_0.buffer instanceof ArrayBuffer && salt_0.BYTES_PER_ELEMENT === 1 && salt_0.length === 32)) {
      __compactRuntime.typeError('derive_boot_commitment_with_jubjub',
                                 'argument 1',
                                 'account.compact line 349 char 1',
                                 'Bytes<32>',
                                 salt_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
      __compactRuntime.typeError('derive_boot_commitment_with_jubjub',
                                 'argument 2',
                                 'account.compact line 349 char 1',
                                 'JubjubPoint',
                                 pk_0)
    }
    return _dummyContract._derive_boot_commitment_with_jubjub_0(salt_0, pk_0);
  },
  derive_boot_commitment_with_k256: (...args_0) => {
    if (args_0.length !== 3) {
      throw new __compactRuntime.CompactError(`derive_boot_commitment_with_k256: expected 3 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const salt_0 = args_0[0];
    const pk_0 = args_0[1];
    const envelope_0 = args_0[2];
    if (!(salt_0.buffer instanceof ArrayBuffer && salt_0.BYTES_PER_ELEMENT === 1 && salt_0.length === 32)) {
      __compactRuntime.typeError('derive_boot_commitment_with_k256',
                                 'argument 1',
                                 'account.compact line 360 char 1',
                                 'Bytes<32>',
                                 salt_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
      __compactRuntime.typeError('derive_boot_commitment_with_k256',
                                 'argument 2',
                                 'account.compact line 360 char 1',
                                 'Secp256k1Point',
                                 pk_0)
    }
    if (!(typeof(envelope_0) === 'bigint' && envelope_0 >= 0n && envelope_0 <= 255n)) {
      __compactRuntime.typeError('derive_boot_commitment_with_k256',
                                 'argument 3',
                                 'account.compact line 360 char 1',
                                 'Uint<0..256>',
                                 envelope_0)
    }
    return _dummyContract._derive_boot_commitment_with_k256_0(salt_0,
                                                              pk_0,
                                                              envelope_0);
  },
  derive_device_entry_with_jubjub: (...args_0) => {
    if (args_0.length !== 4) {
      throw new __compactRuntime.CompactError(`derive_device_entry_with_jubjub: expected 4 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const pk_0 = args_0[1];
    const epoch_0 = args_0[2];
    const counter_0 = args_0[3];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('derive_device_entry_with_jubjub',
                                 'argument 1',
                                 'account.compact line 383 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
      __compactRuntime.typeError('derive_device_entry_with_jubjub',
                                 'argument 2',
                                 'account.compact line 383 char 1',
                                 'JubjubPoint',
                                 pk_0)
    }
    if (!(typeof(epoch_0) === 'bigint' && epoch_0 >= 0n && epoch_0 <= 4294967295n)) {
      __compactRuntime.typeError('derive_device_entry_with_jubjub',
                                 'argument 3',
                                 'account.compact line 383 char 1',
                                 'Uint<0..4294967296>',
                                 epoch_0)
    }
    if (!(typeof(counter_0) === 'bigint' && counter_0 >= 0n && counter_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('derive_device_entry_with_jubjub',
                                 'argument 4',
                                 'account.compact line 383 char 1',
                                 'Uint<0..18446744073709551616>',
                                 counter_0)
    }
    return _dummyContract._derive_device_entry_with_jubjub_0(self_addr_0,
                                                             pk_0,
                                                             epoch_0,
                                                             counter_0);
  },
  derive_device_entry_with_k256: (...args_0) => {
    if (args_0.length !== 5) {
      throw new __compactRuntime.CompactError(`derive_device_entry_with_k256: expected 5 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const pk_0 = args_0[1];
    const envelope_0 = args_0[2];
    const epoch_0 = args_0[3];
    const counter_0 = args_0[4];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('derive_device_entry_with_k256',
                                 'argument 1',
                                 'account.compact line 408 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
      __compactRuntime.typeError('derive_device_entry_with_k256',
                                 'argument 2',
                                 'account.compact line 408 char 1',
                                 'Secp256k1Point',
                                 pk_0)
    }
    if (!(typeof(envelope_0) === 'bigint' && envelope_0 >= 0n && envelope_0 <= 255n)) {
      __compactRuntime.typeError('derive_device_entry_with_k256',
                                 'argument 3',
                                 'account.compact line 408 char 1',
                                 'Uint<0..256>',
                                 envelope_0)
    }
    if (!(typeof(epoch_0) === 'bigint' && epoch_0 >= 0n && epoch_0 <= 4294967295n)) {
      __compactRuntime.typeError('derive_device_entry_with_k256',
                                 'argument 4',
                                 'account.compact line 408 char 1',
                                 'Uint<0..4294967296>',
                                 epoch_0)
    }
    if (!(typeof(counter_0) === 'bigint' && counter_0 >= 0n && counter_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('derive_device_entry_with_k256',
                                 'argument 5',
                                 'account.compact line 408 char 1',
                                 'Uint<0..18446744073709551616>',
                                 counter_0)
    }
    return _dummyContract._derive_device_entry_with_k256_0(self_addr_0,
                                                           pk_0,
                                                           envelope_0,
                                                           epoch_0,
                                                           counter_0);
  },
  envelope_digest: (...args_0) => {
    if (args_0.length !== 2) {
      throw new __compactRuntime.CompactError(`envelope_digest: expected 2 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const envelope_0 = args_0[0];
    const challenge_0 = args_0[1];
    if (!(typeof(envelope_0) === 'bigint' && envelope_0 >= 0n && envelope_0 <= 255n)) {
      __compactRuntime.typeError('envelope_digest',
                                 'argument 1',
                                 'account.compact line 457 char 1',
                                 'Uint<0..256>',
                                 envelope_0)
    }
    if (!(challenge_0.buffer instanceof ArrayBuffer && challenge_0.BYTES_PER_ELEMENT === 1 && challenge_0.length === 32)) {
      __compactRuntime.typeError('envelope_digest',
                                 'argument 2',
                                 'account.compact line 457 char 1',
                                 'Bytes<32>',
                                 challenge_0)
    }
    return _dummyContract._envelope_digest_0(envelope_0, challenge_0);
  },
  compute_public_point_with_jubjub: (...args_0) => {
    if (args_0.length !== 1) {
      throw new __compactRuntime.CompactError(`compute_public_point_with_jubjub: expected 1 argument (as invoked from Typescript), received ${args_0.length}`);
    }
    const scalar_0 = args_0[0];
    if (!(typeof(scalar_0) === 'bigint' && scalar_0 >= 0 && scalar_0 <= __compactRuntime.MAX_FIELD)) {
      __compactRuntime.typeError('compute_public_point_with_jubjub',
                                 'argument 1',
                                 'account.compact line 470 char 1',
                                 'Field',
                                 scalar_0)
    }
    return _dummyContract._compute_public_point_with_jubjub_0(scalar_0);
  },
  compute_public_point_with_k256: (...args_0) => {
    if (args_0.length !== 1) {
      throw new __compactRuntime.CompactError(`compute_public_point_with_k256: expected 1 argument (as invoked from Typescript), received ${args_0.length}`);
    }
    const scalar_0 = args_0[0];
    if (!(typeof(scalar_0) === 'bigint' && scalar_0 >= 0 && scalar_0 <= __compactRuntime.MAX_SECP256K1_SCALAR)) {
      __compactRuntime.typeError('compute_public_point_with_k256',
                                 'argument 1',
                                 'account.compact line 474 char 1',
                                 'Secp256k1Scalar',
                                 scalar_0)
    }
    return _dummyContract._compute_public_point_with_k256_0(scalar_0);
  },
  challenge_withdraw_unshielded_with_jubjub: (...args_0) => {
    if (args_0.length !== 8) {
      throw new __compactRuntime.CompactError(`challenge_withdraw_unshielded_with_jubjub: expected 8 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const sig_r_0 = args_0[1];
    const pk_0 = args_0[2];
    const color_0 = args_0[3];
    const amount_0 = args_0[4];
    const recipient_0 = args_0[5];
    const nonce_value_0 = args_0[6];
    const grind_nonce_0 = args_0[7];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_jubjub',
                                 'argument 1',
                                 'account.compact line 491 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_jubjub',
                                 'argument 2',
                                 'account.compact line 491 char 1',
                                 'JubjubPoint',
                                 sig_r_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_jubjub',
                                 'argument 3',
                                 'account.compact line 491 char 1',
                                 'JubjubPoint',
                                 pk_0)
    }
    if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_jubjub',
                                 'argument 4',
                                 'account.compact line 491 char 1',
                                 'Bytes<32>',
                                 color_0)
    }
    if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_jubjub',
                                 'argument 5',
                                 'account.compact line 491 char 1',
                                 'Uint<0..340282366920938463463374607431768211456>',
                                 amount_0)
    }
    if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_jubjub',
                                 'argument 6',
                                 'account.compact line 491 char 1',
                                 'struct UserAddress<bytes: Bytes<32>>',
                                 recipient_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_jubjub',
                                 'argument 7',
                                 'account.compact line 491 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_jubjub',
                                 'argument 8',
                                 'account.compact line 491 char 1',
                                 'Uint<0..18446744073709551616>',
                                 grind_nonce_0)
    }
    return _dummyContract._challenge_withdraw_unshielded_with_jubjub_0(self_addr_0,
                                                                       sig_r_0,
                                                                       pk_0,
                                                                       color_0,
                                                                       amount_0,
                                                                       recipient_0,
                                                                       nonce_value_0,
                                                                       grind_nonce_0);
  },
  challenge_withdraw_shielded_with_jubjub: (...args_0) => {
    if (args_0.length !== 9) {
      throw new __compactRuntime.CompactError(`challenge_withdraw_shielded_with_jubjub: expected 9 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const sig_r_0 = args_0[1];
    const pk_0 = args_0[2];
    const recipient_0 = args_0[3];
    const color_0 = args_0[4];
    const amount_0 = args_0[5];
    const coin_0 = args_0[6];
    const nonce_value_0 = args_0[7];
    const grind_nonce_0 = args_0[8];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_jubjub',
                                 'argument 1',
                                 'account.compact line 513 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_jubjub',
                                 'argument 2',
                                 'account.compact line 513 char 1',
                                 'JubjubPoint',
                                 sig_r_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_jubjub',
                                 'argument 3',
                                 'account.compact line 513 char 1',
                                 'JubjubPoint',
                                 pk_0)
    }
    if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_jubjub',
                                 'argument 4',
                                 'account.compact line 513 char 1',
                                 'struct ZswapCoinPublicKey<bytes: Bytes<32>>',
                                 recipient_0)
    }
    if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_jubjub',
                                 'argument 5',
                                 'account.compact line 513 char 1',
                                 'Bytes<32>',
                                 color_0)
    }
    if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_jubjub',
                                 'argument 6',
                                 'account.compact line 513 char 1',
                                 'Uint<0..340282366920938463463374607431768211456>',
                                 amount_0)
    }
    if (!(typeof(coin_0) === 'object' && coin_0.nonce.buffer instanceof ArrayBuffer && coin_0.nonce.BYTES_PER_ELEMENT === 1 && coin_0.nonce.length === 32 && coin_0.color.buffer instanceof ArrayBuffer && coin_0.color.BYTES_PER_ELEMENT === 1 && coin_0.color.length === 32 && typeof(coin_0.value) === 'bigint' && coin_0.value >= 0n && coin_0.value <= 340282366920938463463374607431768211455n && typeof(coin_0.mt_index) === 'bigint' && coin_0.mt_index >= 0n && coin_0.mt_index <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_jubjub',
                                 'argument 7',
                                 'account.compact line 513 char 1',
                                 'struct QualifiedShieldedCoinInfo<nonce: Bytes<32>, color: Bytes<32>, value: Uint<0..340282366920938463463374607431768211456>, mt_index: Uint<0..18446744073709551616>>',
                                 coin_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_jubjub',
                                 'argument 8',
                                 'account.compact line 513 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_jubjub',
                                 'argument 9',
                                 'account.compact line 513 char 1',
                                 'Uint<0..18446744073709551616>',
                                 grind_nonce_0)
    }
    return _dummyContract._challenge_withdraw_shielded_with_jubjub_0(self_addr_0,
                                                                     sig_r_0,
                                                                     pk_0,
                                                                     recipient_0,
                                                                     color_0,
                                                                     amount_0,
                                                                     coin_0,
                                                                     nonce_value_0,
                                                                     grind_nonce_0);
  },
  challenge_withdraw_shielded_to_contract_with_jubjub: (...args_0) => {
    if (args_0.length !== 9) {
      throw new __compactRuntime.CompactError(`challenge_withdraw_shielded_to_contract_with_jubjub: expected 9 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const sig_r_0 = args_0[1];
    const pk_0 = args_0[2];
    const recipient_0 = args_0[3];
    const color_0 = args_0[4];
    const amount_0 = args_0[5];
    const coin_0 = args_0[6];
    const nonce_value_0 = args_0[7];
    const grind_nonce_0 = args_0[8];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_jubjub',
                                 'argument 1',
                                 'account.compact line 532 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_jubjub',
                                 'argument 2',
                                 'account.compact line 532 char 1',
                                 'JubjubPoint',
                                 sig_r_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_jubjub',
                                 'argument 3',
                                 'account.compact line 532 char 1',
                                 'JubjubPoint',
                                 pk_0)
    }
    if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_jubjub',
                                 'argument 4',
                                 'account.compact line 532 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 recipient_0)
    }
    if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_jubjub',
                                 'argument 5',
                                 'account.compact line 532 char 1',
                                 'Bytes<32>',
                                 color_0)
    }
    if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_jubjub',
                                 'argument 6',
                                 'account.compact line 532 char 1',
                                 'Uint<0..340282366920938463463374607431768211456>',
                                 amount_0)
    }
    if (!(typeof(coin_0) === 'object' && coin_0.nonce.buffer instanceof ArrayBuffer && coin_0.nonce.BYTES_PER_ELEMENT === 1 && coin_0.nonce.length === 32 && coin_0.color.buffer instanceof ArrayBuffer && coin_0.color.BYTES_PER_ELEMENT === 1 && coin_0.color.length === 32 && typeof(coin_0.value) === 'bigint' && coin_0.value >= 0n && coin_0.value <= 340282366920938463463374607431768211455n && typeof(coin_0.mt_index) === 'bigint' && coin_0.mt_index >= 0n && coin_0.mt_index <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_jubjub',
                                 'argument 7',
                                 'account.compact line 532 char 1',
                                 'struct QualifiedShieldedCoinInfo<nonce: Bytes<32>, color: Bytes<32>, value: Uint<0..340282366920938463463374607431768211456>, mt_index: Uint<0..18446744073709551616>>',
                                 coin_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_jubjub',
                                 'argument 8',
                                 'account.compact line 532 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_jubjub',
                                 'argument 9',
                                 'account.compact line 532 char 1',
                                 'Uint<0..18446744073709551616>',
                                 grind_nonce_0)
    }
    return _dummyContract._challenge_withdraw_shielded_to_contract_with_jubjub_0(self_addr_0,
                                                                                 sig_r_0,
                                                                                 pk_0,
                                                                                 recipient_0,
                                                                                 color_0,
                                                                                 amount_0,
                                                                                 coin_0,
                                                                                 nonce_value_0,
                                                                                 grind_nonce_0);
  },
  challenge_append_inbox_with_jubjub: (...args_0) => {
    if (args_0.length !== 6) {
      throw new __compactRuntime.CompactError(`challenge_append_inbox_with_jubjub: expected 6 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const sig_r_0 = args_0[1];
    const pk_0 = args_0[2];
    const entry_0 = args_0[3];
    const nonce_value_0 = args_0[4];
    const grind_nonce_0 = args_0[5];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_append_inbox_with_jubjub',
                                 'argument 1',
                                 'account.compact line 551 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_append_inbox_with_jubjub',
                                 'argument 2',
                                 'account.compact line 551 char 1',
                                 'JubjubPoint',
                                 sig_r_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_append_inbox_with_jubjub',
                                 'argument 3',
                                 'account.compact line 551 char 1',
                                 'JubjubPoint',
                                 pk_0)
    }
    if (!(entry_0.buffer instanceof ArrayBuffer && entry_0.BYTES_PER_ELEMENT === 1 && entry_0.length === 192)) {
      __compactRuntime.typeError('challenge_append_inbox_with_jubjub',
                                 'argument 4',
                                 'account.compact line 551 char 1',
                                 'Bytes<192>',
                                 entry_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_append_inbox_with_jubjub',
                                 'argument 5',
                                 'account.compact line 551 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_append_inbox_with_jubjub',
                                 'argument 6',
                                 'account.compact line 551 char 1',
                                 'Uint<0..18446744073709551616>',
                                 grind_nonce_0)
    }
    return _dummyContract._challenge_append_inbox_with_jubjub_0(self_addr_0,
                                                                sig_r_0,
                                                                pk_0,
                                                                entry_0,
                                                                nonce_value_0,
                                                                grind_nonce_0);
  },
  challenge_rotate_enc_key_with_jubjub: (...args_0) => {
    if (args_0.length !== 6) {
      throw new __compactRuntime.CompactError(`challenge_rotate_enc_key_with_jubjub: expected 6 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const sig_r_0 = args_0[1];
    const pk_0 = args_0[2];
    const new_key_0 = args_0[3];
    const nonce_value_0 = args_0[4];
    const grind_nonce_0 = args_0[5];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_rotate_enc_key_with_jubjub',
                                 'argument 1',
                                 'account.compact line 567 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_rotate_enc_key_with_jubjub',
                                 'argument 2',
                                 'account.compact line 567 char 1',
                                 'JubjubPoint',
                                 sig_r_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_rotate_enc_key_with_jubjub',
                                 'argument 3',
                                 'account.compact line 567 char 1',
                                 'JubjubPoint',
                                 pk_0)
    }
    if (!(new_key_0.buffer instanceof ArrayBuffer && new_key_0.BYTES_PER_ELEMENT === 1 && new_key_0.length === 32)) {
      __compactRuntime.typeError('challenge_rotate_enc_key_with_jubjub',
                                 'argument 4',
                                 'account.compact line 567 char 1',
                                 'Bytes<32>',
                                 new_key_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_rotate_enc_key_with_jubjub',
                                 'argument 5',
                                 'account.compact line 567 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_rotate_enc_key_with_jubjub',
                                 'argument 6',
                                 'account.compact line 567 char 1',
                                 'Uint<0..18446744073709551616>',
                                 grind_nonce_0)
    }
    return _dummyContract._challenge_rotate_enc_key_with_jubjub_0(self_addr_0,
                                                                  sig_r_0,
                                                                  pk_0,
                                                                  new_key_0,
                                                                  nonce_value_0,
                                                                  grind_nonce_0);
  },
  challenge_add_device_with_jubjub: (...args_0) => {
    if (args_0.length !== 6) {
      throw new __compactRuntime.CompactError(`challenge_add_device_with_jubjub: expected 6 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const sig_r_0 = args_0[1];
    const pk_0 = args_0[2];
    const new_entry_0 = args_0[3];
    const nonce_value_0 = args_0[4];
    const grind_nonce_0 = args_0[5];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_add_device_with_jubjub',
                                 'argument 1',
                                 'account.compact line 587 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_add_device_with_jubjub',
                                 'argument 2',
                                 'account.compact line 587 char 1',
                                 'JubjubPoint',
                                 sig_r_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_add_device_with_jubjub',
                                 'argument 3',
                                 'account.compact line 587 char 1',
                                 'JubjubPoint',
                                 pk_0)
    }
    if (!(new_entry_0.buffer instanceof ArrayBuffer && new_entry_0.BYTES_PER_ELEMENT === 1 && new_entry_0.length === 32)) {
      __compactRuntime.typeError('challenge_add_device_with_jubjub',
                                 'argument 4',
                                 'account.compact line 587 char 1',
                                 'Bytes<32>',
                                 new_entry_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_add_device_with_jubjub',
                                 'argument 5',
                                 'account.compact line 587 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_add_device_with_jubjub',
                                 'argument 6',
                                 'account.compact line 587 char 1',
                                 'Uint<0..18446744073709551616>',
                                 grind_nonce_0)
    }
    return _dummyContract._challenge_add_device_with_jubjub_0(self_addr_0,
                                                              sig_r_0,
                                                              pk_0,
                                                              new_entry_0,
                                                              nonce_value_0,
                                                              grind_nonce_0);
  },
  challenge_remove_device_with_jubjub: (...args_0) => {
    if (args_0.length !== 6) {
      throw new __compactRuntime.CompactError(`challenge_remove_device_with_jubjub: expected 6 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const sig_r_0 = args_0[1];
    const pk_0 = args_0[2];
    const entry_0 = args_0[3];
    const nonce_value_0 = args_0[4];
    const grind_nonce_0 = args_0[5];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_remove_device_with_jubjub',
                                 'argument 1',
                                 'account.compact line 603 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_remove_device_with_jubjub',
                                 'argument 2',
                                 'account.compact line 603 char 1',
                                 'JubjubPoint',
                                 sig_r_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_remove_device_with_jubjub',
                                 'argument 3',
                                 'account.compact line 603 char 1',
                                 'JubjubPoint',
                                 pk_0)
    }
    if (!(entry_0.buffer instanceof ArrayBuffer && entry_0.BYTES_PER_ELEMENT === 1 && entry_0.length === 32)) {
      __compactRuntime.typeError('challenge_remove_device_with_jubjub',
                                 'argument 4',
                                 'account.compact line 603 char 1',
                                 'Bytes<32>',
                                 entry_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_remove_device_with_jubjub',
                                 'argument 5',
                                 'account.compact line 603 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_remove_device_with_jubjub',
                                 'argument 6',
                                 'account.compact line 603 char 1',
                                 'Uint<0..18446744073709551616>',
                                 grind_nonce_0)
    }
    return _dummyContract._challenge_remove_device_with_jubjub_0(self_addr_0,
                                                                 sig_r_0,
                                                                 pk_0,
                                                                 entry_0,
                                                                 nonce_value_0,
                                                                 grind_nonce_0);
  },
  challenge_withdraw_unshielded_with_k256: (...args_0) => {
    if (args_0.length !== 6) {
      throw new __compactRuntime.CompactError(`challenge_withdraw_unshielded_with_k256: expected 6 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const pk_0 = args_0[1];
    const color_0 = args_0[2];
    const amount_0 = args_0[3];
    const recipient_0 = args_0[4];
    const nonce_value_0 = args_0[5];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_k256',
                                 'argument 1',
                                 'account.compact line 628 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_k256',
                                 'argument 2',
                                 'account.compact line 628 char 1',
                                 'Secp256k1Point',
                                 pk_0)
    }
    if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_k256',
                                 'argument 3',
                                 'account.compact line 628 char 1',
                                 'Bytes<32>',
                                 color_0)
    }
    if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_k256',
                                 'argument 4',
                                 'account.compact line 628 char 1',
                                 'Uint<0..340282366920938463463374607431768211456>',
                                 amount_0)
    }
    if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_k256',
                                 'argument 5',
                                 'account.compact line 628 char 1',
                                 'struct UserAddress<bytes: Bytes<32>>',
                                 recipient_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_k256',
                                 'argument 6',
                                 'account.compact line 628 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    return _dummyContract._challenge_withdraw_unshielded_with_k256_0(self_addr_0,
                                                                     pk_0,
                                                                     color_0,
                                                                     amount_0,
                                                                     recipient_0,
                                                                     nonce_value_0);
  },
  challenge_withdraw_shielded_with_k256: (...args_0) => {
    if (args_0.length !== 7) {
      throw new __compactRuntime.CompactError(`challenge_withdraw_shielded_with_k256: expected 7 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const pk_0 = args_0[1];
    const recipient_0 = args_0[2];
    const color_0 = args_0[3];
    const amount_0 = args_0[4];
    const coin_0 = args_0[5];
    const nonce_value_0 = args_0[6];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_k256',
                                 'argument 1',
                                 'account.compact line 646 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_k256',
                                 'argument 2',
                                 'account.compact line 646 char 1',
                                 'Secp256k1Point',
                                 pk_0)
    }
    if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_k256',
                                 'argument 3',
                                 'account.compact line 646 char 1',
                                 'struct ZswapCoinPublicKey<bytes: Bytes<32>>',
                                 recipient_0)
    }
    if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_k256',
                                 'argument 4',
                                 'account.compact line 646 char 1',
                                 'Bytes<32>',
                                 color_0)
    }
    if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_k256',
                                 'argument 5',
                                 'account.compact line 646 char 1',
                                 'Uint<0..340282366920938463463374607431768211456>',
                                 amount_0)
    }
    if (!(typeof(coin_0) === 'object' && coin_0.nonce.buffer instanceof ArrayBuffer && coin_0.nonce.BYTES_PER_ELEMENT === 1 && coin_0.nonce.length === 32 && coin_0.color.buffer instanceof ArrayBuffer && coin_0.color.BYTES_PER_ELEMENT === 1 && coin_0.color.length === 32 && typeof(coin_0.value) === 'bigint' && coin_0.value >= 0n && coin_0.value <= 340282366920938463463374607431768211455n && typeof(coin_0.mt_index) === 'bigint' && coin_0.mt_index >= 0n && coin_0.mt_index <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_k256',
                                 'argument 6',
                                 'account.compact line 646 char 1',
                                 'struct QualifiedShieldedCoinInfo<nonce: Bytes<32>, color: Bytes<32>, value: Uint<0..340282366920938463463374607431768211456>, mt_index: Uint<0..18446744073709551616>>',
                                 coin_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_k256',
                                 'argument 7',
                                 'account.compact line 646 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    return _dummyContract._challenge_withdraw_shielded_with_k256_0(self_addr_0,
                                                                   pk_0,
                                                                   recipient_0,
                                                                   color_0,
                                                                   amount_0,
                                                                   coin_0,
                                                                   nonce_value_0);
  },
  challenge_withdraw_shielded_to_contract_with_k256: (...args_0) => {
    if (args_0.length !== 7) {
      throw new __compactRuntime.CompactError(`challenge_withdraw_shielded_to_contract_with_k256: expected 7 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const pk_0 = args_0[1];
    const recipient_0 = args_0[2];
    const color_0 = args_0[3];
    const amount_0 = args_0[4];
    const coin_0 = args_0[5];
    const nonce_value_0 = args_0[6];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_k256',
                                 'argument 1',
                                 'account.compact line 665 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_k256',
                                 'argument 2',
                                 'account.compact line 665 char 1',
                                 'Secp256k1Point',
                                 pk_0)
    }
    if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_k256',
                                 'argument 3',
                                 'account.compact line 665 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 recipient_0)
    }
    if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_k256',
                                 'argument 4',
                                 'account.compact line 665 char 1',
                                 'Bytes<32>',
                                 color_0)
    }
    if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_k256',
                                 'argument 5',
                                 'account.compact line 665 char 1',
                                 'Uint<0..340282366920938463463374607431768211456>',
                                 amount_0)
    }
    if (!(typeof(coin_0) === 'object' && coin_0.nonce.buffer instanceof ArrayBuffer && coin_0.nonce.BYTES_PER_ELEMENT === 1 && coin_0.nonce.length === 32 && coin_0.color.buffer instanceof ArrayBuffer && coin_0.color.BYTES_PER_ELEMENT === 1 && coin_0.color.length === 32 && typeof(coin_0.value) === 'bigint' && coin_0.value >= 0n && coin_0.value <= 340282366920938463463374607431768211455n && typeof(coin_0.mt_index) === 'bigint' && coin_0.mt_index >= 0n && coin_0.mt_index <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_k256',
                                 'argument 6',
                                 'account.compact line 665 char 1',
                                 'struct QualifiedShieldedCoinInfo<nonce: Bytes<32>, color: Bytes<32>, value: Uint<0..340282366920938463463374607431768211456>, mt_index: Uint<0..18446744073709551616>>',
                                 coin_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_k256',
                                 'argument 7',
                                 'account.compact line 665 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    return _dummyContract._challenge_withdraw_shielded_to_contract_with_k256_0(self_addr_0,
                                                                               pk_0,
                                                                               recipient_0,
                                                                               color_0,
                                                                               amount_0,
                                                                               coin_0,
                                                                               nonce_value_0);
  },
  challenge_append_inbox_with_k256: (...args_0) => {
    if (args_0.length !== 4) {
      throw new __compactRuntime.CompactError(`challenge_append_inbox_with_k256: expected 4 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const pk_0 = args_0[1];
    const entry_0 = args_0[2];
    const nonce_value_0 = args_0[3];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_append_inbox_with_k256',
                                 'argument 1',
                                 'account.compact line 684 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
      __compactRuntime.typeError('challenge_append_inbox_with_k256',
                                 'argument 2',
                                 'account.compact line 684 char 1',
                                 'Secp256k1Point',
                                 pk_0)
    }
    if (!(entry_0.buffer instanceof ArrayBuffer && entry_0.BYTES_PER_ELEMENT === 1 && entry_0.length === 192)) {
      __compactRuntime.typeError('challenge_append_inbox_with_k256',
                                 'argument 3',
                                 'account.compact line 684 char 1',
                                 'Bytes<192>',
                                 entry_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_append_inbox_with_k256',
                                 'argument 4',
                                 'account.compact line 684 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    return _dummyContract._challenge_append_inbox_with_k256_0(self_addr_0,
                                                              pk_0,
                                                              entry_0,
                                                              nonce_value_0);
  },
  challenge_rotate_enc_key_with_k256: (...args_0) => {
    if (args_0.length !== 4) {
      throw new __compactRuntime.CompactError(`challenge_rotate_enc_key_with_k256: expected 4 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const pk_0 = args_0[1];
    const new_key_0 = args_0[2];
    const nonce_value_0 = args_0[3];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_rotate_enc_key_with_k256',
                                 'argument 1',
                                 'account.compact line 700 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
      __compactRuntime.typeError('challenge_rotate_enc_key_with_k256',
                                 'argument 2',
                                 'account.compact line 700 char 1',
                                 'Secp256k1Point',
                                 pk_0)
    }
    if (!(new_key_0.buffer instanceof ArrayBuffer && new_key_0.BYTES_PER_ELEMENT === 1 && new_key_0.length === 32)) {
      __compactRuntime.typeError('challenge_rotate_enc_key_with_k256',
                                 'argument 3',
                                 'account.compact line 700 char 1',
                                 'Bytes<32>',
                                 new_key_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_rotate_enc_key_with_k256',
                                 'argument 4',
                                 'account.compact line 700 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    return _dummyContract._challenge_rotate_enc_key_with_k256_0(self_addr_0,
                                                                pk_0,
                                                                new_key_0,
                                                                nonce_value_0);
  },
  challenge_add_device_with_k256: (...args_0) => {
    if (args_0.length !== 4) {
      throw new __compactRuntime.CompactError(`challenge_add_device_with_k256: expected 4 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const pk_0 = args_0[1];
    const new_entry_0 = args_0[2];
    const nonce_value_0 = args_0[3];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_add_device_with_k256',
                                 'argument 1',
                                 'account.compact line 716 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
      __compactRuntime.typeError('challenge_add_device_with_k256',
                                 'argument 2',
                                 'account.compact line 716 char 1',
                                 'Secp256k1Point',
                                 pk_0)
    }
    if (!(new_entry_0.buffer instanceof ArrayBuffer && new_entry_0.BYTES_PER_ELEMENT === 1 && new_entry_0.length === 32)) {
      __compactRuntime.typeError('challenge_add_device_with_k256',
                                 'argument 3',
                                 'account.compact line 716 char 1',
                                 'Bytes<32>',
                                 new_entry_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_add_device_with_k256',
                                 'argument 4',
                                 'account.compact line 716 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    return _dummyContract._challenge_add_device_with_k256_0(self_addr_0,
                                                            pk_0,
                                                            new_entry_0,
                                                            nonce_value_0);
  },
  challenge_remove_device_with_k256: (...args_0) => {
    if (args_0.length !== 4) {
      throw new __compactRuntime.CompactError(`challenge_remove_device_with_k256: expected 4 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const pk_0 = args_0[1];
    const entry_0 = args_0[2];
    const nonce_value_0 = args_0[3];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_remove_device_with_k256',
                                 'argument 1',
                                 'account.compact line 732 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
      __compactRuntime.typeError('challenge_remove_device_with_k256',
                                 'argument 2',
                                 'account.compact line 732 char 1',
                                 'Secp256k1Point',
                                 pk_0)
    }
    if (!(entry_0.buffer instanceof ArrayBuffer && entry_0.BYTES_PER_ELEMENT === 1 && entry_0.length === 32)) {
      __compactRuntime.typeError('challenge_remove_device_with_k256',
                                 'argument 3',
                                 'account.compact line 732 char 1',
                                 'Bytes<32>',
                                 entry_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_remove_device_with_k256',
                                 'argument 4',
                                 'account.compact line 732 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    return _dummyContract._challenge_remove_device_with_k256_0(self_addr_0,
                                                               pk_0,
                                                               entry_0,
                                                               nonce_value_0);
  },
  derive_grant_id_with_k256: (...args_0) => {
    if (args_0.length !== 5) {
      throw new __compactRuntime.CompactError(`derive_grant_id_with_k256: expected 5 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const pk_0 = args_0[1];
    const envelope_0 = args_0[2];
    const origin_hash_0 = args_0[3];
    const slot_0 = args_0[4];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('derive_grant_id_with_k256',
                                 'argument 1',
                                 'account.compact line 1355 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
      __compactRuntime.typeError('derive_grant_id_with_k256',
                                 'argument 2',
                                 'account.compact line 1355 char 1',
                                 'Secp256k1Point',
                                 pk_0)
    }
    if (!(typeof(envelope_0) === 'bigint' && envelope_0 >= 0n && envelope_0 <= 255n)) {
      __compactRuntime.typeError('derive_grant_id_with_k256',
                                 'argument 3',
                                 'account.compact line 1355 char 1',
                                 'Uint<0..256>',
                                 envelope_0)
    }
    if (!(origin_hash_0.buffer instanceof ArrayBuffer && origin_hash_0.BYTES_PER_ELEMENT === 1 && origin_hash_0.length === 32)) {
      __compactRuntime.typeError('derive_grant_id_with_k256',
                                 'argument 4',
                                 'account.compact line 1355 char 1',
                                 'Bytes<32>',
                                 origin_hash_0)
    }
    if (!(typeof(slot_0) === 'bigint' && slot_0 >= 0n && slot_0 <= 255n)) {
      __compactRuntime.typeError('derive_grant_id_with_k256',
                                 'argument 5',
                                 'account.compact line 1355 char 1',
                                 'Uint<0..256>',
                                 slot_0)
    }
    return _dummyContract._derive_grant_id_with_k256_0(self_addr_0,
                                                       pk_0,
                                                       envelope_0,
                                                       origin_hash_0,
                                                       slot_0);
  },
  derive_grant_id_with_jubjub: (...args_0) => {
    if (args_0.length !== 4) {
      throw new __compactRuntime.CompactError(`derive_grant_id_with_jubjub: expected 4 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const pk_0 = args_0[1];
    const origin_hash_0 = args_0[2];
    const slot_0 = args_0[3];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('derive_grant_id_with_jubjub',
                                 'argument 1',
                                 'account.compact line 1369 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
      __compactRuntime.typeError('derive_grant_id_with_jubjub',
                                 'argument 2',
                                 'account.compact line 1369 char 1',
                                 'JubjubPoint',
                                 pk_0)
    }
    if (!(origin_hash_0.buffer instanceof ArrayBuffer && origin_hash_0.BYTES_PER_ELEMENT === 1 && origin_hash_0.length === 32)) {
      __compactRuntime.typeError('derive_grant_id_with_jubjub',
                                 'argument 3',
                                 'account.compact line 1369 char 1',
                                 'Bytes<32>',
                                 origin_hash_0)
    }
    if (!(typeof(slot_0) === 'bigint' && slot_0 >= 0n && slot_0 <= 255n)) {
      __compactRuntime.typeError('derive_grant_id_with_jubjub',
                                 'argument 4',
                                 'account.compact line 1369 char 1',
                                 'Uint<0..256>',
                                 slot_0)
    }
    return _dummyContract._derive_grant_id_with_jubjub_0(self_addr_0,
                                                         pk_0,
                                                         origin_hash_0,
                                                         slot_0);
  },
  derive_grant_object_commit: (...args_0) => {
    if (args_0.length !== 5) {
      throw new __compactRuntime.CompactError(`derive_grant_object_commit: expected 5 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const scope_salt_0 = args_0[0];
    const color_0 = args_0[1];
    const recipient_kind_0 = args_0[2];
    const recipient_0 = args_0[3];
    const max_coin_value_0 = args_0[4];
    if (!(scope_salt_0.buffer instanceof ArrayBuffer && scope_salt_0.BYTES_PER_ELEMENT === 1 && scope_salt_0.length === 32)) {
      __compactRuntime.typeError('derive_grant_object_commit',
                                 'argument 1',
                                 'account.compact line 1385 char 1',
                                 'Bytes<32>',
                                 scope_salt_0)
    }
    if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
      __compactRuntime.typeError('derive_grant_object_commit',
                                 'argument 2',
                                 'account.compact line 1385 char 1',
                                 'Bytes<32>',
                                 color_0)
    }
    if (!(typeof(recipient_kind_0) === 'bigint' && recipient_kind_0 >= 0n && recipient_kind_0 <= 255n)) {
      __compactRuntime.typeError('derive_grant_object_commit',
                                 'argument 3',
                                 'account.compact line 1385 char 1',
                                 'Uint<0..256>',
                                 recipient_kind_0)
    }
    if (!(recipient_0.buffer instanceof ArrayBuffer && recipient_0.BYTES_PER_ELEMENT === 1 && recipient_0.length === 32)) {
      __compactRuntime.typeError('derive_grant_object_commit',
                                 'argument 4',
                                 'account.compact line 1385 char 1',
                                 'Bytes<32>',
                                 recipient_0)
    }
    if (!(typeof(max_coin_value_0) === 'bigint' && max_coin_value_0 >= 0n && max_coin_value_0 <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('derive_grant_object_commit',
                                 'argument 5',
                                 'account.compact line 1385 char 1',
                                 'Uint<0..340282366920938463463374607431768211456>',
                                 max_coin_value_0)
    }
    return _dummyContract._derive_grant_object_commit_0(scope_salt_0,
                                                        color_0,
                                                        recipient_kind_0,
                                                        recipient_0,
                                                        max_coin_value_0);
  },
  derive_grant_spent_commit: (...args_0) => {
    if (args_0.length !== 2) {
      throw new __compactRuntime.CompactError(`derive_grant_spent_commit: expected 2 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const scope_salt_0 = args_0[0];
    const spent_0 = args_0[1];
    if (!(scope_salt_0.buffer instanceof ArrayBuffer && scope_salt_0.BYTES_PER_ELEMENT === 1 && scope_salt_0.length === 32)) {
      __compactRuntime.typeError('derive_grant_spent_commit',
                                 'argument 1',
                                 'account.compact line 1398 char 1',
                                 'Bytes<32>',
                                 scope_salt_0)
    }
    if (!(typeof(spent_0) === 'bigint' && spent_0 >= 0n && spent_0 <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('derive_grant_spent_commit',
                                 'argument 2',
                                 'account.compact line 1398 char 1',
                                 'Uint<0..340282366920938463463374607431768211456>',
                                 spent_0)
    }
    return _dummyContract._derive_grant_spent_commit_0(scope_salt_0, spent_0);
  },
  derive_grant_rp_commit: (...args_0) => {
    if (args_0.length !== 2) {
      throw new __compactRuntime.CompactError(`derive_grant_rp_commit: expected 2 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const scope_salt_0 = args_0[0];
    const rp_id_hash_0 = args_0[1];
    if (!(scope_salt_0.buffer instanceof ArrayBuffer && scope_salt_0.BYTES_PER_ELEMENT === 1 && scope_salt_0.length === 32)) {
      __compactRuntime.typeError('derive_grant_rp_commit',
                                 'argument 1',
                                 'account.compact line 1407 char 1',
                                 'Bytes<32>',
                                 scope_salt_0)
    }
    if (!(rp_id_hash_0.buffer instanceof ArrayBuffer && rp_id_hash_0.BYTES_PER_ELEMENT === 1 && rp_id_hash_0.length === 32)) {
      __compactRuntime.typeError('derive_grant_rp_commit',
                                 'argument 2',
                                 'account.compact line 1407 char 1',
                                 'Bytes<32>',
                                 rp_id_hash_0)
    }
    return _dummyContract._derive_grant_rp_commit_0(scope_salt_0, rp_id_hash_0);
  },
  derive_grant_scope_digest: (...args_0) => {
    if (args_0.length !== 16) {
      throw new __compactRuntime.CompactError(`derive_grant_scope_digest: expected 16 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const scope_salt_0 = args_0[0];
    const op_withdraw_unshielded_0 = args_0[1];
    const op_withdraw_shielded_0 = args_0[2];
    const op_withdraw_shielded_to_contract_0 = args_0[3];
    const read_0 = args_0[4];
    const color_0 = args_0[5];
    const recipient_kind_0 = args_0[6];
    const recipient_0 = args_0[7];
    const max_coin_value_0 = args_0[8];
    const per_call_cap_0 = args_0[9];
    const cap_0 = args_0[10];
    const expires_at_0 = args_0[11];
    const rp_id_hash_0 = args_0[12];
    const read_pk_hash_0 = args_0[13];
    const window_len_0 = args_0[14];
    const window_cap_0 = args_0[15];
    if (!(scope_salt_0.buffer instanceof ArrayBuffer && scope_salt_0.BYTES_PER_ELEMENT === 1 && scope_salt_0.length === 32)) {
      __compactRuntime.typeError('derive_grant_scope_digest',
                                 'argument 1',
                                 'account.compact line 1420 char 1',
                                 'Bytes<32>',
                                 scope_salt_0)
    }
    if (!(typeof(op_withdraw_unshielded_0) === 'boolean')) {
      __compactRuntime.typeError('derive_grant_scope_digest',
                                 'argument 2',
                                 'account.compact line 1420 char 1',
                                 'Boolean',
                                 op_withdraw_unshielded_0)
    }
    if (!(typeof(op_withdraw_shielded_0) === 'boolean')) {
      __compactRuntime.typeError('derive_grant_scope_digest',
                                 'argument 3',
                                 'account.compact line 1420 char 1',
                                 'Boolean',
                                 op_withdraw_shielded_0)
    }
    if (!(typeof(op_withdraw_shielded_to_contract_0) === 'boolean')) {
      __compactRuntime.typeError('derive_grant_scope_digest',
                                 'argument 4',
                                 'account.compact line 1420 char 1',
                                 'Boolean',
                                 op_withdraw_shielded_to_contract_0)
    }
    if (!(typeof(read_0) === 'boolean')) {
      __compactRuntime.typeError('derive_grant_scope_digest',
                                 'argument 5',
                                 'account.compact line 1420 char 1',
                                 'Boolean',
                                 read_0)
    }
    if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
      __compactRuntime.typeError('derive_grant_scope_digest',
                                 'argument 6',
                                 'account.compact line 1420 char 1',
                                 'Bytes<32>',
                                 color_0)
    }
    if (!(typeof(recipient_kind_0) === 'bigint' && recipient_kind_0 >= 0n && recipient_kind_0 <= 255n)) {
      __compactRuntime.typeError('derive_grant_scope_digest',
                                 'argument 7',
                                 'account.compact line 1420 char 1',
                                 'Uint<0..256>',
                                 recipient_kind_0)
    }
    if (!(recipient_0.buffer instanceof ArrayBuffer && recipient_0.BYTES_PER_ELEMENT === 1 && recipient_0.length === 32)) {
      __compactRuntime.typeError('derive_grant_scope_digest',
                                 'argument 8',
                                 'account.compact line 1420 char 1',
                                 'Bytes<32>',
                                 recipient_0)
    }
    if (!(typeof(max_coin_value_0) === 'bigint' && max_coin_value_0 >= 0n && max_coin_value_0 <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('derive_grant_scope_digest',
                                 'argument 9',
                                 'account.compact line 1420 char 1',
                                 'Uint<0..340282366920938463463374607431768211456>',
                                 max_coin_value_0)
    }
    if (!(typeof(per_call_cap_0) === 'bigint' && per_call_cap_0 >= 0n && per_call_cap_0 <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('derive_grant_scope_digest',
                                 'argument 10',
                                 'account.compact line 1420 char 1',
                                 'Uint<0..340282366920938463463374607431768211456>',
                                 per_call_cap_0)
    }
    if (!(typeof(cap_0) === 'bigint' && cap_0 >= 0n && cap_0 <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('derive_grant_scope_digest',
                                 'argument 11',
                                 'account.compact line 1420 char 1',
                                 'Uint<0..340282366920938463463374607431768211456>',
                                 cap_0)
    }
    if (!(typeof(expires_at_0) === 'bigint' && expires_at_0 >= 0n && expires_at_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('derive_grant_scope_digest',
                                 'argument 12',
                                 'account.compact line 1420 char 1',
                                 'Uint<0..18446744073709551616>',
                                 expires_at_0)
    }
    if (!(rp_id_hash_0.buffer instanceof ArrayBuffer && rp_id_hash_0.BYTES_PER_ELEMENT === 1 && rp_id_hash_0.length === 32)) {
      __compactRuntime.typeError('derive_grant_scope_digest',
                                 'argument 13',
                                 'account.compact line 1420 char 1',
                                 'Bytes<32>',
                                 rp_id_hash_0)
    }
    if (!(read_pk_hash_0.buffer instanceof ArrayBuffer && read_pk_hash_0.BYTES_PER_ELEMENT === 1 && read_pk_hash_0.length === 32)) {
      __compactRuntime.typeError('derive_grant_scope_digest',
                                 'argument 14',
                                 'account.compact line 1420 char 1',
                                 'Bytes<32>',
                                 read_pk_hash_0)
    }
    if (!(typeof(window_len_0) === 'bigint' && window_len_0 >= 0n && window_len_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('derive_grant_scope_digest',
                                 'argument 15',
                                 'account.compact line 1420 char 1',
                                 'Uint<0..18446744073709551616>',
                                 window_len_0)
    }
    if (!(typeof(window_cap_0) === 'bigint' && window_cap_0 >= 0n && window_cap_0 <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('derive_grant_scope_digest',
                                 'argument 16',
                                 'account.compact line 1420 char 1',
                                 'Uint<0..340282366920938463463374607431768211456>',
                                 window_cap_0)
    }
    return _dummyContract._derive_grant_scope_digest_0(scope_salt_0,
                                                       op_withdraw_unshielded_0,
                                                       op_withdraw_shielded_0,
                                                       op_withdraw_shielded_to_contract_0,
                                                       read_0,
                                                       color_0,
                                                       recipient_kind_0,
                                                       recipient_0,
                                                       max_coin_value_0,
                                                       per_call_cap_0,
                                                       cap_0,
                                                       expires_at_0,
                                                       rp_id_hash_0,
                                                       read_pk_hash_0,
                                                       window_len_0,
                                                       window_cap_0);
  },
  challenge_withdraw_unshielded_with_grant_k256: (...args_0) => {
    if (args_0.length !== 8) {
      throw new __compactRuntime.CompactError(`challenge_withdraw_unshielded_with_grant_k256: expected 8 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const pk_0 = args_0[1];
    const grant_id_0 = args_0[2];
    const issued_at_0 = args_0[3];
    const color_0 = args_0[4];
    const amount_0 = args_0[5];
    const recipient_0 = args_0[6];
    const nonce_value_0 = args_0[7];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_grant_k256',
                                 'argument 1',
                                 'account.compact line 1458 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_grant_k256',
                                 'argument 2',
                                 'account.compact line 1458 char 1',
                                 'Secp256k1Point',
                                 pk_0)
    }
    if (!(grant_id_0.buffer instanceof ArrayBuffer && grant_id_0.BYTES_PER_ELEMENT === 1 && grant_id_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_grant_k256',
                                 'argument 3',
                                 'account.compact line 1458 char 1',
                                 'Bytes<32>',
                                 grant_id_0)
    }
    if (!(typeof(issued_at_0) === 'bigint' && issued_at_0 >= 0n && issued_at_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_grant_k256',
                                 'argument 4',
                                 'account.compact line 1458 char 1',
                                 'Uint<0..18446744073709551616>',
                                 issued_at_0)
    }
    if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_grant_k256',
                                 'argument 5',
                                 'account.compact line 1458 char 1',
                                 'Bytes<32>',
                                 color_0)
    }
    if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_grant_k256',
                                 'argument 6',
                                 'account.compact line 1458 char 1',
                                 'Uint<0..340282366920938463463374607431768211456>',
                                 amount_0)
    }
    if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_grant_k256',
                                 'argument 7',
                                 'account.compact line 1458 char 1',
                                 'struct UserAddress<bytes: Bytes<32>>',
                                 recipient_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_grant_k256',
                                 'argument 8',
                                 'account.compact line 1458 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    return _dummyContract._challenge_withdraw_unshielded_with_grant_k256_0(self_addr_0,
                                                                           pk_0,
                                                                           grant_id_0,
                                                                           issued_at_0,
                                                                           color_0,
                                                                           amount_0,
                                                                           recipient_0,
                                                                           nonce_value_0);
  },
  challenge_withdraw_shielded_with_grant_k256: (...args_0) => {
    if (args_0.length !== 11) {
      throw new __compactRuntime.CompactError(`challenge_withdraw_shielded_with_grant_k256: expected 11 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const pk_0 = args_0[1];
    const grant_id_0 = args_0[2];
    const issued_at_0 = args_0[3];
    const recipient_0 = args_0[4];
    const color_0 = args_0[5];
    const amount_0 = args_0[6];
    const change_entry_0 = args_0[7];
    const enc_pk_0 = args_0[8];
    const coin_0 = args_0[9];
    const nonce_value_0 = args_0[10];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_k256',
                                 'argument 1',
                                 'account.compact line 1480 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_k256',
                                 'argument 2',
                                 'account.compact line 1480 char 1',
                                 'Secp256k1Point',
                                 pk_0)
    }
    if (!(grant_id_0.buffer instanceof ArrayBuffer && grant_id_0.BYTES_PER_ELEMENT === 1 && grant_id_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_k256',
                                 'argument 3',
                                 'account.compact line 1480 char 1',
                                 'Bytes<32>',
                                 grant_id_0)
    }
    if (!(typeof(issued_at_0) === 'bigint' && issued_at_0 >= 0n && issued_at_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_k256',
                                 'argument 4',
                                 'account.compact line 1480 char 1',
                                 'Uint<0..18446744073709551616>',
                                 issued_at_0)
    }
    if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_k256',
                                 'argument 5',
                                 'account.compact line 1480 char 1',
                                 'struct ZswapCoinPublicKey<bytes: Bytes<32>>',
                                 recipient_0)
    }
    if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_k256',
                                 'argument 6',
                                 'account.compact line 1480 char 1',
                                 'Bytes<32>',
                                 color_0)
    }
    if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_k256',
                                 'argument 7',
                                 'account.compact line 1480 char 1',
                                 'Uint<0..340282366920938463463374607431768211456>',
                                 amount_0)
    }
    if (!(change_entry_0.buffer instanceof ArrayBuffer && change_entry_0.BYTES_PER_ELEMENT === 1 && change_entry_0.length === 192)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_k256',
                                 'argument 8',
                                 'account.compact line 1480 char 1',
                                 'Bytes<192>',
                                 change_entry_0)
    }
    if (!(enc_pk_0.buffer instanceof ArrayBuffer && enc_pk_0.BYTES_PER_ELEMENT === 1 && enc_pk_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_k256',
                                 'argument 9',
                                 'account.compact line 1480 char 1',
                                 'Bytes<32>',
                                 enc_pk_0)
    }
    if (!(typeof(coin_0) === 'object' && coin_0.nonce.buffer instanceof ArrayBuffer && coin_0.nonce.BYTES_PER_ELEMENT === 1 && coin_0.nonce.length === 32 && coin_0.color.buffer instanceof ArrayBuffer && coin_0.color.BYTES_PER_ELEMENT === 1 && coin_0.color.length === 32 && typeof(coin_0.value) === 'bigint' && coin_0.value >= 0n && coin_0.value <= 340282366920938463463374607431768211455n && typeof(coin_0.mt_index) === 'bigint' && coin_0.mt_index >= 0n && coin_0.mt_index <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_k256',
                                 'argument 10',
                                 'account.compact line 1480 char 1',
                                 'struct QualifiedShieldedCoinInfo<nonce: Bytes<32>, color: Bytes<32>, value: Uint<0..340282366920938463463374607431768211456>, mt_index: Uint<0..18446744073709551616>>',
                                 coin_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_k256',
                                 'argument 11',
                                 'account.compact line 1480 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    return _dummyContract._challenge_withdraw_shielded_with_grant_k256_0(self_addr_0,
                                                                         pk_0,
                                                                         grant_id_0,
                                                                         issued_at_0,
                                                                         recipient_0,
                                                                         color_0,
                                                                         amount_0,
                                                                         change_entry_0,
                                                                         enc_pk_0,
                                                                         coin_0,
                                                                         nonce_value_0);
  },
  challenge_withdraw_shielded_to_contract_with_grant_k256: (...args_0) => {
    if (args_0.length !== 11) {
      throw new __compactRuntime.CompactError(`challenge_withdraw_shielded_to_contract_with_grant_k256: expected 11 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const pk_0 = args_0[1];
    const grant_id_0 = args_0[2];
    const issued_at_0 = args_0[3];
    const recipient_0 = args_0[4];
    const color_0 = args_0[5];
    const amount_0 = args_0[6];
    const change_entry_0 = args_0[7];
    const enc_pk_0 = args_0[8];
    const coin_0 = args_0[9];
    const nonce_value_0 = args_0[10];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_k256',
                                 'argument 1',
                                 'account.compact line 1505 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_k256',
                                 'argument 2',
                                 'account.compact line 1505 char 1',
                                 'Secp256k1Point',
                                 pk_0)
    }
    if (!(grant_id_0.buffer instanceof ArrayBuffer && grant_id_0.BYTES_PER_ELEMENT === 1 && grant_id_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_k256',
                                 'argument 3',
                                 'account.compact line 1505 char 1',
                                 'Bytes<32>',
                                 grant_id_0)
    }
    if (!(typeof(issued_at_0) === 'bigint' && issued_at_0 >= 0n && issued_at_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_k256',
                                 'argument 4',
                                 'account.compact line 1505 char 1',
                                 'Uint<0..18446744073709551616>',
                                 issued_at_0)
    }
    if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_k256',
                                 'argument 5',
                                 'account.compact line 1505 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 recipient_0)
    }
    if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_k256',
                                 'argument 6',
                                 'account.compact line 1505 char 1',
                                 'Bytes<32>',
                                 color_0)
    }
    if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_k256',
                                 'argument 7',
                                 'account.compact line 1505 char 1',
                                 'Uint<0..340282366920938463463374607431768211456>',
                                 amount_0)
    }
    if (!(change_entry_0.buffer instanceof ArrayBuffer && change_entry_0.BYTES_PER_ELEMENT === 1 && change_entry_0.length === 192)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_k256',
                                 'argument 8',
                                 'account.compact line 1505 char 1',
                                 'Bytes<192>',
                                 change_entry_0)
    }
    if (!(enc_pk_0.buffer instanceof ArrayBuffer && enc_pk_0.BYTES_PER_ELEMENT === 1 && enc_pk_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_k256',
                                 'argument 9',
                                 'account.compact line 1505 char 1',
                                 'Bytes<32>',
                                 enc_pk_0)
    }
    if (!(typeof(coin_0) === 'object' && coin_0.nonce.buffer instanceof ArrayBuffer && coin_0.nonce.BYTES_PER_ELEMENT === 1 && coin_0.nonce.length === 32 && coin_0.color.buffer instanceof ArrayBuffer && coin_0.color.BYTES_PER_ELEMENT === 1 && coin_0.color.length === 32 && typeof(coin_0.value) === 'bigint' && coin_0.value >= 0n && coin_0.value <= 340282366920938463463374607431768211455n && typeof(coin_0.mt_index) === 'bigint' && coin_0.mt_index >= 0n && coin_0.mt_index <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_k256',
                                 'argument 10',
                                 'account.compact line 1505 char 1',
                                 'struct QualifiedShieldedCoinInfo<nonce: Bytes<32>, color: Bytes<32>, value: Uint<0..340282366920938463463374607431768211456>, mt_index: Uint<0..18446744073709551616>>',
                                 coin_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_k256',
                                 'argument 11',
                                 'account.compact line 1505 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    return _dummyContract._challenge_withdraw_shielded_to_contract_with_grant_k256_0(self_addr_0,
                                                                                     pk_0,
                                                                                     grant_id_0,
                                                                                     issued_at_0,
                                                                                     recipient_0,
                                                                                     color_0,
                                                                                     amount_0,
                                                                                     change_entry_0,
                                                                                     enc_pk_0,
                                                                                     coin_0,
                                                                                     nonce_value_0);
  },
  challenge_withdraw_unshielded_with_grant_jubjub: (...args_0) => {
    if (args_0.length !== 10) {
      throw new __compactRuntime.CompactError(`challenge_withdraw_unshielded_with_grant_jubjub: expected 10 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const sig_r_0 = args_0[1];
    const pk_0 = args_0[2];
    const grant_id_0 = args_0[3];
    const issued_at_0 = args_0[4];
    const color_0 = args_0[5];
    const amount_0 = args_0[6];
    const recipient_0 = args_0[7];
    const nonce_value_0 = args_0[8];
    const grind_nonce_0 = args_0[9];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_grant_jubjub',
                                 'argument 1',
                                 'account.compact line 1542 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_grant_jubjub',
                                 'argument 2',
                                 'account.compact line 1542 char 1',
                                 'JubjubPoint',
                                 sig_r_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_grant_jubjub',
                                 'argument 3',
                                 'account.compact line 1542 char 1',
                                 'JubjubPoint',
                                 pk_0)
    }
    if (!(grant_id_0.buffer instanceof ArrayBuffer && grant_id_0.BYTES_PER_ELEMENT === 1 && grant_id_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_grant_jubjub',
                                 'argument 4',
                                 'account.compact line 1542 char 1',
                                 'Bytes<32>',
                                 grant_id_0)
    }
    if (!(typeof(issued_at_0) === 'bigint' && issued_at_0 >= 0n && issued_at_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_grant_jubjub',
                                 'argument 5',
                                 'account.compact line 1542 char 1',
                                 'Uint<0..18446744073709551616>',
                                 issued_at_0)
    }
    if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_grant_jubjub',
                                 'argument 6',
                                 'account.compact line 1542 char 1',
                                 'Bytes<32>',
                                 color_0)
    }
    if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_grant_jubjub',
                                 'argument 7',
                                 'account.compact line 1542 char 1',
                                 'Uint<0..340282366920938463463374607431768211456>',
                                 amount_0)
    }
    if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_grant_jubjub',
                                 'argument 8',
                                 'account.compact line 1542 char 1',
                                 'struct UserAddress<bytes: Bytes<32>>',
                                 recipient_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_grant_jubjub',
                                 'argument 9',
                                 'account.compact line 1542 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_unshielded_with_grant_jubjub',
                                 'argument 10',
                                 'account.compact line 1542 char 1',
                                 'Uint<0..18446744073709551616>',
                                 grind_nonce_0)
    }
    return _dummyContract._challenge_withdraw_unshielded_with_grant_jubjub_0(self_addr_0,
                                                                             sig_r_0,
                                                                             pk_0,
                                                                             grant_id_0,
                                                                             issued_at_0,
                                                                             color_0,
                                                                             amount_0,
                                                                             recipient_0,
                                                                             nonce_value_0,
                                                                             grind_nonce_0);
  },
  challenge_withdraw_shielded_with_grant_jubjub: (...args_0) => {
    if (args_0.length !== 13) {
      throw new __compactRuntime.CompactError(`challenge_withdraw_shielded_with_grant_jubjub: expected 13 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const sig_r_0 = args_0[1];
    const pk_0 = args_0[2];
    const grant_id_0 = args_0[3];
    const issued_at_0 = args_0[4];
    const recipient_0 = args_0[5];
    const color_0 = args_0[6];
    const amount_0 = args_0[7];
    const change_entry_0 = args_0[8];
    const enc_pk_0 = args_0[9];
    const coin_0 = args_0[10];
    const nonce_value_0 = args_0[11];
    const grind_nonce_0 = args_0[12];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_jubjub',
                                 'argument 1',
                                 'account.compact line 1565 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_jubjub',
                                 'argument 2',
                                 'account.compact line 1565 char 1',
                                 'JubjubPoint',
                                 sig_r_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_jubjub',
                                 'argument 3',
                                 'account.compact line 1565 char 1',
                                 'JubjubPoint',
                                 pk_0)
    }
    if (!(grant_id_0.buffer instanceof ArrayBuffer && grant_id_0.BYTES_PER_ELEMENT === 1 && grant_id_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_jubjub',
                                 'argument 4',
                                 'account.compact line 1565 char 1',
                                 'Bytes<32>',
                                 grant_id_0)
    }
    if (!(typeof(issued_at_0) === 'bigint' && issued_at_0 >= 0n && issued_at_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_jubjub',
                                 'argument 5',
                                 'account.compact line 1565 char 1',
                                 'Uint<0..18446744073709551616>',
                                 issued_at_0)
    }
    if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_jubjub',
                                 'argument 6',
                                 'account.compact line 1565 char 1',
                                 'struct ZswapCoinPublicKey<bytes: Bytes<32>>',
                                 recipient_0)
    }
    if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_jubjub',
                                 'argument 7',
                                 'account.compact line 1565 char 1',
                                 'Bytes<32>',
                                 color_0)
    }
    if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_jubjub',
                                 'argument 8',
                                 'account.compact line 1565 char 1',
                                 'Uint<0..340282366920938463463374607431768211456>',
                                 amount_0)
    }
    if (!(change_entry_0.buffer instanceof ArrayBuffer && change_entry_0.BYTES_PER_ELEMENT === 1 && change_entry_0.length === 192)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_jubjub',
                                 'argument 9',
                                 'account.compact line 1565 char 1',
                                 'Bytes<192>',
                                 change_entry_0)
    }
    if (!(enc_pk_0.buffer instanceof ArrayBuffer && enc_pk_0.BYTES_PER_ELEMENT === 1 && enc_pk_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_jubjub',
                                 'argument 10',
                                 'account.compact line 1565 char 1',
                                 'Bytes<32>',
                                 enc_pk_0)
    }
    if (!(typeof(coin_0) === 'object' && coin_0.nonce.buffer instanceof ArrayBuffer && coin_0.nonce.BYTES_PER_ELEMENT === 1 && coin_0.nonce.length === 32 && coin_0.color.buffer instanceof ArrayBuffer && coin_0.color.BYTES_PER_ELEMENT === 1 && coin_0.color.length === 32 && typeof(coin_0.value) === 'bigint' && coin_0.value >= 0n && coin_0.value <= 340282366920938463463374607431768211455n && typeof(coin_0.mt_index) === 'bigint' && coin_0.mt_index >= 0n && coin_0.mt_index <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_jubjub',
                                 'argument 11',
                                 'account.compact line 1565 char 1',
                                 'struct QualifiedShieldedCoinInfo<nonce: Bytes<32>, color: Bytes<32>, value: Uint<0..340282366920938463463374607431768211456>, mt_index: Uint<0..18446744073709551616>>',
                                 coin_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_jubjub',
                                 'argument 12',
                                 'account.compact line 1565 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_with_grant_jubjub',
                                 'argument 13',
                                 'account.compact line 1565 char 1',
                                 'Uint<0..18446744073709551616>',
                                 grind_nonce_0)
    }
    return _dummyContract._challenge_withdraw_shielded_with_grant_jubjub_0(self_addr_0,
                                                                           sig_r_0,
                                                                           pk_0,
                                                                           grant_id_0,
                                                                           issued_at_0,
                                                                           recipient_0,
                                                                           color_0,
                                                                           amount_0,
                                                                           change_entry_0,
                                                                           enc_pk_0,
                                                                           coin_0,
                                                                           nonce_value_0,
                                                                           grind_nonce_0);
  },
  challenge_withdraw_shielded_to_contract_with_grant_jubjub: (...args_0) => {
    if (args_0.length !== 13) {
      throw new __compactRuntime.CompactError(`challenge_withdraw_shielded_to_contract_with_grant_jubjub: expected 13 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const sig_r_0 = args_0[1];
    const pk_0 = args_0[2];
    const grant_id_0 = args_0[3];
    const issued_at_0 = args_0[4];
    const recipient_0 = args_0[5];
    const color_0 = args_0[6];
    const amount_0 = args_0[7];
    const change_entry_0 = args_0[8];
    const enc_pk_0 = args_0[9];
    const coin_0 = args_0[10];
    const nonce_value_0 = args_0[11];
    const grind_nonce_0 = args_0[12];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_jubjub',
                                 'argument 1',
                                 'account.compact line 1589 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_jubjub',
                                 'argument 2',
                                 'account.compact line 1589 char 1',
                                 'JubjubPoint',
                                 sig_r_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_jubjub',
                                 'argument 3',
                                 'account.compact line 1589 char 1',
                                 'JubjubPoint',
                                 pk_0)
    }
    if (!(grant_id_0.buffer instanceof ArrayBuffer && grant_id_0.BYTES_PER_ELEMENT === 1 && grant_id_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_jubjub',
                                 'argument 4',
                                 'account.compact line 1589 char 1',
                                 'Bytes<32>',
                                 grant_id_0)
    }
    if (!(typeof(issued_at_0) === 'bigint' && issued_at_0 >= 0n && issued_at_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_jubjub',
                                 'argument 5',
                                 'account.compact line 1589 char 1',
                                 'Uint<0..18446744073709551616>',
                                 issued_at_0)
    }
    if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_jubjub',
                                 'argument 6',
                                 'account.compact line 1589 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 recipient_0)
    }
    if (!(color_0.buffer instanceof ArrayBuffer && color_0.BYTES_PER_ELEMENT === 1 && color_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_jubjub',
                                 'argument 7',
                                 'account.compact line 1589 char 1',
                                 'Bytes<32>',
                                 color_0)
    }
    if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_jubjub',
                                 'argument 8',
                                 'account.compact line 1589 char 1',
                                 'Uint<0..340282366920938463463374607431768211456>',
                                 amount_0)
    }
    if (!(change_entry_0.buffer instanceof ArrayBuffer && change_entry_0.BYTES_PER_ELEMENT === 1 && change_entry_0.length === 192)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_jubjub',
                                 'argument 9',
                                 'account.compact line 1589 char 1',
                                 'Bytes<192>',
                                 change_entry_0)
    }
    if (!(enc_pk_0.buffer instanceof ArrayBuffer && enc_pk_0.BYTES_PER_ELEMENT === 1 && enc_pk_0.length === 32)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_jubjub',
                                 'argument 10',
                                 'account.compact line 1589 char 1',
                                 'Bytes<32>',
                                 enc_pk_0)
    }
    if (!(typeof(coin_0) === 'object' && coin_0.nonce.buffer instanceof ArrayBuffer && coin_0.nonce.BYTES_PER_ELEMENT === 1 && coin_0.nonce.length === 32 && coin_0.color.buffer instanceof ArrayBuffer && coin_0.color.BYTES_PER_ELEMENT === 1 && coin_0.color.length === 32 && typeof(coin_0.value) === 'bigint' && coin_0.value >= 0n && coin_0.value <= 340282366920938463463374607431768211455n && typeof(coin_0.mt_index) === 'bigint' && coin_0.mt_index >= 0n && coin_0.mt_index <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_jubjub',
                                 'argument 11',
                                 'account.compact line 1589 char 1',
                                 'struct QualifiedShieldedCoinInfo<nonce: Bytes<32>, color: Bytes<32>, value: Uint<0..340282366920938463463374607431768211456>, mt_index: Uint<0..18446744073709551616>>',
                                 coin_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_jubjub',
                                 'argument 12',
                                 'account.compact line 1589 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_withdraw_shielded_to_contract_with_grant_jubjub',
                                 'argument 13',
                                 'account.compact line 1589 char 1',
                                 'Uint<0..18446744073709551616>',
                                 grind_nonce_0)
    }
    return _dummyContract._challenge_withdraw_shielded_to_contract_with_grant_jubjub_0(self_addr_0,
                                                                                       sig_r_0,
                                                                                       pk_0,
                                                                                       grant_id_0,
                                                                                       issued_at_0,
                                                                                       recipient_0,
                                                                                       color_0,
                                                                                       amount_0,
                                                                                       change_entry_0,
                                                                                       enc_pk_0,
                                                                                       coin_0,
                                                                                       nonce_value_0,
                                                                                       grind_nonce_0);
  },
  challenge_issue_grant_with_k256: (...args_0) => {
    if (args_0.length !== 5) {
      throw new __compactRuntime.CompactError(`challenge_issue_grant_with_k256: expected 5 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const pk_0 = args_0[1];
    const grant_id_0 = args_0[2];
    const scope_digest_0 = args_0[3];
    const nonce_value_0 = args_0[4];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_issue_grant_with_k256',
                                 'argument 1',
                                 'account.compact line 1620 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
      __compactRuntime.typeError('challenge_issue_grant_with_k256',
                                 'argument 2',
                                 'account.compact line 1620 char 1',
                                 'Secp256k1Point',
                                 pk_0)
    }
    if (!(grant_id_0.buffer instanceof ArrayBuffer && grant_id_0.BYTES_PER_ELEMENT === 1 && grant_id_0.length === 32)) {
      __compactRuntime.typeError('challenge_issue_grant_with_k256',
                                 'argument 3',
                                 'account.compact line 1620 char 1',
                                 'Bytes<32>',
                                 grant_id_0)
    }
    if (!(scope_digest_0.buffer instanceof ArrayBuffer && scope_digest_0.BYTES_PER_ELEMENT === 1 && scope_digest_0.length === 32)) {
      __compactRuntime.typeError('challenge_issue_grant_with_k256',
                                 'argument 4',
                                 'account.compact line 1620 char 1',
                                 'Bytes<32>',
                                 scope_digest_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_issue_grant_with_k256',
                                 'argument 5',
                                 'account.compact line 1620 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    return _dummyContract._challenge_issue_grant_with_k256_0(self_addr_0,
                                                             pk_0,
                                                             grant_id_0,
                                                             scope_digest_0,
                                                             nonce_value_0);
  },
  challenge_revoke_grant_with_k256: (...args_0) => {
    if (args_0.length !== 4) {
      throw new __compactRuntime.CompactError(`challenge_revoke_grant_with_k256: expected 4 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const pk_0 = args_0[1];
    const grant_id_0 = args_0[2];
    const nonce_value_0 = args_0[3];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_revoke_grant_with_k256',
                                 'argument 1',
                                 'account.compact line 1637 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
      __compactRuntime.typeError('challenge_revoke_grant_with_k256',
                                 'argument 2',
                                 'account.compact line 1637 char 1',
                                 'Secp256k1Point',
                                 pk_0)
    }
    if (!(grant_id_0.buffer instanceof ArrayBuffer && grant_id_0.BYTES_PER_ELEMENT === 1 && grant_id_0.length === 32)) {
      __compactRuntime.typeError('challenge_revoke_grant_with_k256',
                                 'argument 3',
                                 'account.compact line 1637 char 1',
                                 'Bytes<32>',
                                 grant_id_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_revoke_grant_with_k256',
                                 'argument 4',
                                 'account.compact line 1637 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    return _dummyContract._challenge_revoke_grant_with_k256_0(self_addr_0,
                                                              pk_0,
                                                              grant_id_0,
                                                              nonce_value_0);
  },
  challenge_revoke_all_grants_with_k256: (...args_0) => {
    if (args_0.length !== 3) {
      throw new __compactRuntime.CompactError(`challenge_revoke_all_grants_with_k256: expected 3 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const pk_0 = args_0[1];
    const nonce_value_0 = args_0[2];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_revoke_all_grants_with_k256',
                                 'argument 1',
                                 'account.compact line 1653 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint' && typeof(pk_0.identity) == 'boolean')) {
      __compactRuntime.typeError('challenge_revoke_all_grants_with_k256',
                                 'argument 2',
                                 'account.compact line 1653 char 1',
                                 'Secp256k1Point',
                                 pk_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_revoke_all_grants_with_k256',
                                 'argument 3',
                                 'account.compact line 1653 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    return _dummyContract._challenge_revoke_all_grants_with_k256_0(self_addr_0,
                                                                   pk_0,
                                                                   nonce_value_0);
  },
  challenge_issue_grant_with_jubjub: (...args_0) => {
    if (args_0.length !== 7) {
      throw new __compactRuntime.CompactError(`challenge_issue_grant_with_jubjub: expected 7 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const sig_r_0 = args_0[1];
    const pk_0 = args_0[2];
    const grant_id_0 = args_0[3];
    const scope_digest_0 = args_0[4];
    const nonce_value_0 = args_0[5];
    const grind_nonce_0 = args_0[6];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_issue_grant_with_jubjub',
                                 'argument 1',
                                 'account.compact line 1675 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_issue_grant_with_jubjub',
                                 'argument 2',
                                 'account.compact line 1675 char 1',
                                 'JubjubPoint',
                                 sig_r_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_issue_grant_with_jubjub',
                                 'argument 3',
                                 'account.compact line 1675 char 1',
                                 'JubjubPoint',
                                 pk_0)
    }
    if (!(grant_id_0.buffer instanceof ArrayBuffer && grant_id_0.BYTES_PER_ELEMENT === 1 && grant_id_0.length === 32)) {
      __compactRuntime.typeError('challenge_issue_grant_with_jubjub',
                                 'argument 4',
                                 'account.compact line 1675 char 1',
                                 'Bytes<32>',
                                 grant_id_0)
    }
    if (!(scope_digest_0.buffer instanceof ArrayBuffer && scope_digest_0.BYTES_PER_ELEMENT === 1 && scope_digest_0.length === 32)) {
      __compactRuntime.typeError('challenge_issue_grant_with_jubjub',
                                 'argument 5',
                                 'account.compact line 1675 char 1',
                                 'Bytes<32>',
                                 scope_digest_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_issue_grant_with_jubjub',
                                 'argument 6',
                                 'account.compact line 1675 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_issue_grant_with_jubjub',
                                 'argument 7',
                                 'account.compact line 1675 char 1',
                                 'Uint<0..18446744073709551616>',
                                 grind_nonce_0)
    }
    return _dummyContract._challenge_issue_grant_with_jubjub_0(self_addr_0,
                                                               sig_r_0,
                                                               pk_0,
                                                               grant_id_0,
                                                               scope_digest_0,
                                                               nonce_value_0,
                                                               grind_nonce_0);
  },
  challenge_revoke_grant_with_jubjub: (...args_0) => {
    if (args_0.length !== 6) {
      throw new __compactRuntime.CompactError(`challenge_revoke_grant_with_jubjub: expected 6 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const sig_r_0 = args_0[1];
    const pk_0 = args_0[2];
    const grant_id_0 = args_0[3];
    const nonce_value_0 = args_0[4];
    const grind_nonce_0 = args_0[5];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_revoke_grant_with_jubjub',
                                 'argument 1',
                                 'account.compact line 1692 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_revoke_grant_with_jubjub',
                                 'argument 2',
                                 'account.compact line 1692 char 1',
                                 'JubjubPoint',
                                 sig_r_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_revoke_grant_with_jubjub',
                                 'argument 3',
                                 'account.compact line 1692 char 1',
                                 'JubjubPoint',
                                 pk_0)
    }
    if (!(grant_id_0.buffer instanceof ArrayBuffer && grant_id_0.BYTES_PER_ELEMENT === 1 && grant_id_0.length === 32)) {
      __compactRuntime.typeError('challenge_revoke_grant_with_jubjub',
                                 'argument 4',
                                 'account.compact line 1692 char 1',
                                 'Bytes<32>',
                                 grant_id_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_revoke_grant_with_jubjub',
                                 'argument 5',
                                 'account.compact line 1692 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_revoke_grant_with_jubjub',
                                 'argument 6',
                                 'account.compact line 1692 char 1',
                                 'Uint<0..18446744073709551616>',
                                 grind_nonce_0)
    }
    return _dummyContract._challenge_revoke_grant_with_jubjub_0(self_addr_0,
                                                                sig_r_0,
                                                                pk_0,
                                                                grant_id_0,
                                                                nonce_value_0,
                                                                grind_nonce_0);
  },
  challenge_revoke_all_grants_with_jubjub: (...args_0) => {
    if (args_0.length !== 5) {
      throw new __compactRuntime.CompactError(`challenge_revoke_all_grants_with_jubjub: expected 5 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const self_addr_0 = args_0[0];
    const sig_r_0 = args_0[1];
    const pk_0 = args_0[2];
    const nonce_value_0 = args_0[3];
    const grind_nonce_0 = args_0[4];
    if (!(typeof(self_addr_0) === 'object' && self_addr_0.bytes.buffer instanceof ArrayBuffer && self_addr_0.bytes.BYTES_PER_ELEMENT === 1 && self_addr_0.bytes.length === 32)) {
      __compactRuntime.typeError('challenge_revoke_all_grants_with_jubjub',
                                 'argument 1',
                                 'account.compact line 1708 char 1',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 self_addr_0)
    }
    if (!(typeof(sig_r_0.x) === 'bigint' && typeof(sig_r_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_revoke_all_grants_with_jubjub',
                                 'argument 2',
                                 'account.compact line 1708 char 1',
                                 'JubjubPoint',
                                 sig_r_0)
    }
    if (!(typeof(pk_0.x) === 'bigint' && typeof(pk_0.y) === 'bigint')) {
      __compactRuntime.typeError('challenge_revoke_all_grants_with_jubjub',
                                 'argument 3',
                                 'account.compact line 1708 char 1',
                                 'JubjubPoint',
                                 pk_0)
    }
    if (!(typeof(nonce_value_0) === 'bigint' && nonce_value_0 >= 0n && nonce_value_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_revoke_all_grants_with_jubjub',
                                 'argument 4',
                                 'account.compact line 1708 char 1',
                                 'Uint<0..18446744073709551616>',
                                 nonce_value_0)
    }
    if (!(typeof(grind_nonce_0) === 'bigint' && grind_nonce_0 >= 0n && grind_nonce_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('challenge_revoke_all_grants_with_jubjub',
                                 'argument 5',
                                 'account.compact line 1708 char 1',
                                 'Uint<0..18446744073709551616>',
                                 grind_nonce_0)
    }
    return _dummyContract._challenge_revoke_all_grants_with_jubjub_0(self_addr_0,
                                                                     sig_r_0,
                                                                     pk_0,
                                                                     nonce_value_0,
                                                                     grind_nonce_0);
  }
};
export const contractReferenceLocations =
  { tag: 'publicLedgerArray', indices: { } };
export const expectedVk = {
  'activate_initial_device_with_jubjub': '61b72fb8e457f3fff7e1a2fb2f1e6b5a1fd25400e63f5eb7ed8f4ba1d07ee2a3',
  'activate_initial_device_with_k256': 'b99bf860911d811c09d8770f2043cd5700fa3ccdcd7999cbd466be3bb8683e21',
  'add_device_with_jubjub': 'c8697688038a558f96bc58ca4fa22929f58a97165e8149df73d52e3b3f27d239',
  'add_device_with_k256': '806204d65e11b5139fd30862ad3485f11d6587f2a4b440e43a27f51b632c6ad5',
  'append_inbox_with_jubjub': 'f5fed7673093963086cd251524bdc76474bd26e42dab481783ff8d99eb3bb913',
  'append_inbox_with_k256': 'd23fd34164d12e5d8b748264fff37a196b936961236a7a799cfe190410dbd674',
  'deposit_shielded': '6761a2e9cb905a115e7705b63b7df57b3c14dfa39fa48411ff6f512b8ff916b3',
  'deposit_unshielded': '3deb950234a50b1515d496d687bd173118cf2e7461ab02d63270dbbd5ac5a973',
  'issue_grant_with_jubjub': 'f0a5240ea57e991ad6a66fa268b156a6c3cb2171512c96b256903b43d8de5bc8',
  'issue_grant_with_k256': '649a12253d095e97355a4710a8444476b0fb5b195345f3c534cd0c67bd2dcb2a',
  'remove_device_with_jubjub': '9fd6161248d0f6e5b998ff0e837159f6b293cd4d000139845037a5afd208c804',
  'remove_device_with_k256': '2bbd940147b75f52b2a22b48548cf91eb235c159837d74ce6cdae5a8371a70cc',
  'revoke_all_grants_with_jubjub': 'fe56a94e8f768c1355b7896a5304b14421ef6af09d4535bc5d99b888ab4beb65',
  'revoke_all_grants_with_k256': 'e83e57a2560142581952d8f026afb3d71198f5228afcdec54987dfd999eb8688',
  'revoke_grant_with_jubjub': 'e542dc2ed0df1b33d19880e3de99a92fa9ea7d2ae5c11f38f3e050eac623a0df',
  'revoke_grant_with_k256': '4dfccf99c859d6a036ed2942b1129b3a7c62dce3c497607b224d1ff9452dffcc',
  'rotate_enc_key_with_jubjub': 'adba0c81b7feb8b6aaa7566033b971b6891b68332d73d6831cedfcfee5f4ca2e',
  'rotate_enc_key_with_k256': '9a6d69b6940cb41b3b59da2cfbbab454c78aeb05891885bffef5fa7919defbd6',
  'withdraw_shielded_to_contract_with_grant_jubjub': '134e75998c1f7b019f2a6be9c2a1b9bcdbb793cc35ddc717572a11aa939c13ca',
  'withdraw_shielded_to_contract_with_grant_k256': '486e657c0ed88f61c382b663746f5bf83b65db70bfe2e6b8bbde584cbaabb4f3',
  'withdraw_shielded_to_contract_with_jubjub': '97bdf4ea1008e60dad0e380c5f38f915bf628c3657847f9160823c3cd66dfe7c',
  'withdraw_shielded_to_contract_with_k256': '69779e7fbc339ede136d6dbd5d221eae910de6a5e45821f25338b7b1e315f22a',
  'withdraw_shielded_with_grant_jubjub': '0cb1872592771405dfe55c19f658bf200f2894a0f8302294396182c8dbbc6d4e',
  'withdraw_shielded_with_grant_k256': '6808f92a59dcda8223fcdf9bb4c95fe5f59276d9aa50e8190482bad4b8974e44',
  'withdraw_shielded_with_jubjub': '213cde888f27853e1426c3a89b1aa1030040caad78443442a668f0fe4495bfe9',
  'withdraw_shielded_with_k256': 'b880ac395328eba9b6945d79f74f6b5d3626d52834ecd5d47a5d955f3df5f502',
  'withdraw_unshielded_with_grant_jubjub': 'd00588cd75ee506d72501ae8cd1411dd8725c9d01b95b7e0c4d9fff9d19e9a30',
  'withdraw_unshielded_with_grant_k256': '48268edb4e0ac12fef96489689bbed160b50f40c520fc3abde114aff034213b8',
  'withdraw_unshielded_with_jubjub': '2e2468d7565526dcbbc0a18c6de097492d1cc5ea564c1e502a29be0d34ba7444',
  'withdraw_unshielded_with_k256': '9cd311f0e0bc57ae19cdbef42ab7486a9f21b2775852904a222738f757dceb1d',
};

//# sourceMappingURL=index.js.map
