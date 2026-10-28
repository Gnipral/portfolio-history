import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'

/** A passkey as checked against: its id, public key and signature counter. */
export interface PasskeyCredential {
  id: string
  publicKey: Uint8Array
  counter: number
  transports: string[]
}

/** The WebAuthn ceremonies, behind an interface so the routes can be tested without a device. */
export interface Passkeys {
  /** Options for the browser; their `challenge` is what the answer must sign. */
  registrationOptions(args: { rpID: string; userID: Uint8Array; userName: string }): Promise<{ challenge: string }>
  /** The new passkey when the answer is valid, else null. */
  verifyRegistration(args: { response: unknown; challenge: string; origin: string; rpID: string }): Promise<PasskeyCredential | null>
  authenticationOptions(args: { rpID: string }): Promise<{ challenge: string }>
  /** The new signature counter when the answer is valid, else null. */
  verifyAuthentication(args: {
    response: unknown
    challenge: string
    origin: string
    rpID: string
    credential: PasskeyCredential
  }): Promise<{ newCounter: number } | null>
}

/** SimpleWebAuthn: the checks of the WebAuthn specification, with the Web Crypto of the Worker. */
export const simpleWebAuthn: Passkeys = {
  registrationOptions: ({ rpID, userID, userName }) =>
    generateRegistrationOptions({
      rpName: 'Portfolio History',
      rpID,
      userName,
      userID: new Uint8Array(userID),
      attestationType: 'none',
      // A discoverable passkey: signing in later needs no user name.
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    }),

  async verifyRegistration({ response, challenge, origin, rpID }) {
    try {
      const result = await verifyRegistrationResponse({
        response: response as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: false,
      })
      if (!result.verified) return null
      const { credential } = result.registrationInfo
      return { id: credential.id, publicKey: new Uint8Array(credential.publicKey), counter: credential.counter, transports: credential.transports ?? [] }
    } catch {
      return null
    }
  },

  authenticationOptions: ({ rpID }) => generateAuthenticationOptions({ rpID, userVerification: 'preferred' }),

  async verifyAuthentication({ response, challenge, origin, rpID, credential }) {
    try {
      const result = await verifyAuthenticationResponse({
        response: response as AuthenticationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: { id: credential.id, publicKey: new Uint8Array(credential.publicKey), counter: credential.counter, transports: credential.transports as never },
        requireUserVerification: false,
      })
      return result.verified ? { newCounter: result.authenticationInfo.newCounter } : null
    } catch {
      return null
    }
  },
}
