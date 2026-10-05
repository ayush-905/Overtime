// The public half of the key that signs Overtime's releases: an update is only
// installed when its latest-mac.yml carries a signature this key checks out, so
// only whoever holds the private half (kept off the repo, see README
// "Releasing") can ship one. Changing it means copies with the old key can't
// update themselves past that release.

export const UPDATE_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAWSK7sPCLt4kt4HJuVm/0J0S0MpapLp0+71B3LUUffcc=
-----END PUBLIC KEY-----
`;
