# Fullstack Playground

## Objectives
In this challenge you will be building a chat application. This chat application should support multiple users and multiple rooms. You do not need to support dynamic creation of rooms, a pre-defined amount will suffice. A user only needs to be in one room at one time.

A room is grouping of users that can talk to each other. Like a group chat. A user should be able to join and leave a room. A user should be able to see some or all history of a room upon joining.
___
_challenge: see if you can allow users to create rooms after the initial requirements are completed. dynamic rooms will be more difficult than a static amount of rooms_
___

To facilitate sending messages between users, you will use a websocket to enable fast, real-time communication. If you are unaware of what websockets are, please read [here](https://www.geeksforgeeks.org/web-tech/what-is-web-socket-and-how-it-is-different-from-the-http/) for more information.

The websocket should only send messages to users for the room the user is currently in. Any spill over could potentially be a security risk.

## Tips
- If you are on Windows, set up WSL before attempting this challenge. It will make your life easier.
- Next.js documentation is your friend. In the olden days you might have seen a backend and frontend in separate repos. Next.js is different and allows you to make server-side-rendered (SSR) applications. Look [here](https://nextjs.org/docs/pages/building-your-application/rendering/server-side-rendering) for more information about SSR applications from Next.js.
- [NVM](https://github.com/nvm-sh/nvm) is a great way to manage your node install (you must have node installed to complete this challenge...). It's not required but it's what I use.

## Final Remarks
If you would like to make a separate backend to manage the websocket that is up to you. Make the challenge your own. The only thing I require is the functionality laid out in the objectives section. In fact, you can forgo Next.js altogether and build this in something else entirely. The choice is yours.

If you want to go the extra mile, deploy this application to a server. Bonus points for that!