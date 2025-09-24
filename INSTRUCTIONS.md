# Fullstack Playground

## Objectives
In this challenge you will be building a chat application. This chat application should support multiple users and multiple rooms. You do not need to support dynamic creation of rooms, a pre-defined amount will suffice. A user only needs to be in one room at one time.

A room is grouping of users that can talk to each other. Like a group chat. A user should be able to join and leave a room. A user should be able to see some or all history of a room upon joining.
___
_challenge: see if you can allow users to create rooms after the initial requirements are completed. dynamic rooms will be more difficult than a static amount of rooms_
___

09/24/2025
## Update
I have created a very rudimentary but also somewhat stylish and unique chat room built to be my very first project (go easy on me)
Pretty much the entirety of this app is developed using Javascript. The backend is a Node.js app, deployed and running on a server (Render).
The frontend (Next.js) is deployed separately (Vercel). Databasing created using Prisma and PostgreSQL

Main features include the following:

User Registration
Validates input
Stores hashed password

User Login
Validates credentials
Updates user status to “online”

User Status Tracking
Tracks online/offline status
Broadcasts status updates to all clients

Chat Messaging
Send messages to rooms
Stores messages in database
Broadcasts new messages to all room members

Room Management
Create private rooms
Invite users to rooms
Accept/decline invitations
Leave rooms (delete if empty)
Edit room names

Real-Time Updates
Uses Socket.io for live communication
Reconnection logic for reliability
Keepalive ping to maintain connection

A stylish UI with much room to be improved on, I actually designed this webapp with the thought of the old school chat room website XAT in mind, maybe it could have been a bit more similar in that regard but for now this is how it will stay until I am inspired to crack at this some more with added features.


09/04/2025
Next.js + Socket.io + Prisma/SQLite

To facilitate sending messages between users, you will use a websocket to enable fast, real-time communication. If you are unaware of what websockets are, please read [here](https://www.geeksforgeeks.org/web-tech/what-is-web-socket-and-how-it-is-different-from-the-http/) for more information.

The websocket should only send messages to users for the room the user is currently in. Any spill over could potentially be a security risk.

## Tips
- If you are on Windows, set up WSL before attempting this challenge. It will make your life easier.
- Next.js documentation is your friend. In the olden days you might have seen a backend and frontend in separate repos. Next.js is different and allows you to make server-side-rendered (SSR) applications. Look [here](https://nextjs.org/docs/pages/building-your-application/rendering/server-side-rendering) for more information about SSR applications from Next.js.
- [NVM](https://github.com/nvm-sh/nvm) is a great way to manage your node install (you must have node installed to complete this challenge...). It's not required but it's what I use.

## Final Remarks
If you would like to make a separate backend to manage the websocket that is up to you. Make the challenge your own. The only thing I require is the functionality laid out in the objectives section. In fact, you can forgo Next.js altogether and build this in something else entirely. The choice is yours.

If you want to go the extra mile, deploy this application to a server. Bonus points for that!