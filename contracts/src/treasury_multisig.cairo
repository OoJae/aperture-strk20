//! A threshold multisig for the registry's `tally_operator`.
//!
//! The registry names one address as its tally operator and fixes it at
//! construction. That address publishes tallies and licenses payouts — and
//! because it chooses the commitment, it chooses who a payout can be claimed
//! by. The cap bounds how much; the timelock bounds how suddenly. Neither
//! bounds *who decides*, and a single key deciding was the last item on the
//! trust model's list.
//!
//! So the operator becomes a contract that requires `quorum` of `signers` to
//! agree. Nothing in the registry changes: it compares `get_caller_address()`
//! against its operator, and a multisig executing a call is that caller.
//!
//! This is a thin wrapper around OpenZeppelin's audited MultisigComponent, on
//! purpose. The component holds every rule that matters — who may submit, who
//! may confirm, when a transaction becomes executable, how a call is hashed
//! into an id. Hand-rolling that for a contract guarding a treasury would be
//! the wrong kind of ambitious.
//!
//! Not an account contract, and it does not need to be: it never pays for a
//! transaction or validates a signature. A signer's own account submits,
//! confirms and executes, and the multisig is what the registry sees at the far
//! end.
//!
//! API verified against openzeppelin_governance 3.0.0 source rather than from
//! memory, per the project's rule about writing against unverified symbols:
//!   initializer(quorum: u32, signers: Span<ContractAddress>)
//!   submit_transaction(to, selector, calldata, salt) -> TransactionID
//!   confirm_transaction(id)
//!   execute_transaction(to, selector, calldata, salt)

#[starknet::contract]
pub mod TreasuryMultisig {
    use openzeppelin_governance::multisig::MultisigComponent;
    use starknet::ContractAddress;

    component!(path: MultisigComponent, storage: multisig, event: MultisigEvent);

    /// The whole external surface. Everything a signer does goes through here.
    #[abi(embed_v0)]
    impl MultisigImpl = MultisigComponent::MultisigImpl<ContractState>;
    impl MultisigInternalImpl = MultisigComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        multisig: MultisigComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        MultisigEvent: MultisigComponent::Event,
    }

    /// Signers and quorum are set once, here.
    ///
    /// The component can change them later, but only through the multisig
    /// itself — a quorum of the current signers has to agree to alter the set.
    /// That is the correct shape: no owner outside the group, and no way for
    /// one signer to remove the others.
    #[constructor]
    fn constructor(ref self: ContractState, quorum: u32, signers: Span<ContractAddress>) {
        self.multisig.initializer(quorum, signers);
    }
}
