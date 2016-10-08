'use strict'

const Promise = require('bluebird')
const Api = require('scaleway')
const util = require('util')
const _ = require('lodash')

module.exports = (conf) => {
  const client = new Api({
    token: conf.apiToken
  })

  const getImages = () => {
    console.log('Getting images.')

    return new Promise((resolve) => {
      client.get('/images').then((res) => {
        resolve(res.body.images)
      })
    })
  }

  const makeServer = (name, serverType, imageId, tags) => {
    const serverData = {
      name: name,
      organization: conf.organization,
      commercial_type: serverType,
      image: imageId,
      tags: tags
    }

    console.log(util.format('Making server "%s" of type "%s"', name, serverType))

    return client
      .post('/servers', serverData)
      .then(() => {
        console.log(util.format('Successfully made server "%s"', name))
      })
  }

  const getServersByName = () => {
    return new Promise((resolve) => {
      client.get('/servers').then((res) => {
        const servers = res.body.servers

        const serversByName = {}

        servers.forEach((server) => {
          serversByName[server.hostname] = server
        })

        resolve(serversByName)
      })
    })
  }

  const createServersIfNotExists = (servers) => {
    return getServersByName().then((serversByName) => {
      const promises = []

      servers.forEach((server) => {
        if (undefined === serversByName[server.name]) {
          promises.push(
            makeServer(server.name, server.type , server.imageId, server.tags)
          )
        } else {
          console.log(util.format('Not making server "%s", server already exists.', server.name))
        }
      })

      if (promises.length > 0) {
        return Promise.all(promises).then(() => {
          console.log('Done making all servers')
        })
      } else {
        console.log('No server to create')

        return
      }
    })
  }

  const deleteStoppedServers = (serversToRelease) => {
    //TODO Release IPs

    return getServersByName().then((servers) => {
      const promises = []

      serversToRelease.forEach((serverToRelease) => {
        const serverName = serverToRelease.name
        const server = servers[serverName]

        if (undefined !== server) {
          if ('stopped' !== server.state) {
            console.log(util.format('Not deleting server "%s": expecting server to be stopped, server was "%s"', serverName, server.state))

            return
          }

          const serverId = server.id
          const serverVolumeIds = []

          console.log(util.format('Deleting server "%s"', serverName))

          _.forEach(server.volumes, (volume) => {
            serverVolumeIds.push(volume.id)
          })

          promises.push(
            client
              .delete('/servers/' + serverId)
              .then(() => {
                console.log(util.format('Done deleting server "%s"', serverName))

                return new Promise((resolve) => {
                  const promises = []

                  console.log(util.format('Deleting volumes for server "%s"', serverName))

                  serverVolumeIds.forEach((serverVolumeId) => {
                    console.log(util.format('Deleting volume "%s" for server "%s"', serverVolumeId, serverName))

                    promises.push(
                      client
                        .delete('/volumes/' + serverVolumeId)
                        .then(() => {
                          console.log(util.format('Done deleting volume "%s" for server "%s"', serverVolumeId, serverName))
                        })
                    )
                  })

                  Promise.all(promises).then(() => {
                    console.log(util.format('Done deleting all volumes for server "%s"', serverName))

                    resolve()
                  })
                })
              })
          )
        } else {
          console.log(util.format('Not deleting server "%s", it does not exist', serverName))
        }
      })

      if (promises.length > 0) {
        Promise.all(promises).then(() => {
          console.log('Done deleting all servers')
        })
      } else {
        console.log('No deletable server found')
      }
    })
  }

  const listServers = (servers) => {
    getServersByName().then((serversByName) => {
      servers.forEach((server) => {
        const serverName = server.name
        const serverByName = serversByName[serverName]

        if (undefined === serverByName) {
          console.log(util.format('Missing server "%s"', serverName))
        } else {
          console.log(serverByName)
        }
      })
    })
  }

  const startServers = (serversToBeCreated) => {
    const powerOnAction = 'poweron'

    getServersByName().then((existingServersByName) => {
      return new Promise((resolve) => {
        const promises = []

        serversToBeCreated.forEach((serverToBeCreated) => {
          const serverName = serverToBeCreated.name
          const server = existingServersByName[serverName]

          if (undefined === server) {
            console.log(util.format('Missing server "%s"', serverName))
          } else {
            const serverId = server.id
            const serverState = server.state

            if ('stopped' !== serverState) {
              console.log(util.format('Not starting server "%s", expecting server to be "stopped", server is "%s"', serverName, serverState))

              return
            }

            promises.push(
              client
                .get('/servers/' + serverId + '/action')
                .then((res) => {
                  const actions = res.body.actions

                  if (actions.indexOf(powerOnAction) === -1) {
                    console.log(util.format('Not starting server "%s": "%s" action is unavailable. Available actions are: %j', serverName, powerOnAction, actions))

                    return
                  }

                  console.log(util.format('Starting server "%s"', serverName))

                  return client
                    .post('/servers/' + serverId + '/action', { action: powerOnAction })
                    .then(() => {
                      console.log(util.format('Done starting server "%s"', serverName))
                    })
                })
            )
          }
        })

        if (promises.length > 0) {
          Promise.all(promises).then(() => {
            console.log('Done starting all servers')

            resolve()
          })
        } else {
          console.log('No server to start')

          resolve()
        }
      })
    })
  }

  const terminateServers = (serversToBeTerminated) => {
    const terminateAction = 'terminate'

    getServersByName().then((existingServersByName) => {
      return new Promise((resolve) => {
        const promises = []

        serversToBeTerminated.forEach((serverToBeTerminated) => {
          const serverName = serverToBeTerminated.name
          const server = existingServersByName[serverName]

          if (undefined === server) {
            console.log(util.format('Missing server "%s"', serverName))
          } else {
            const serverId = server.id
            const serverState = server.state

            if ('running' !== serverState) {
              console.log(util.format('Not terminating server "%s", expecting server to be "running", server is "%s"', serverName, serverState))

              return
            }

            promises.push(
              client
                .get('/servers/' + serverId + '/action')
                .then((res) => {
                  const actions = res.body.actions

                  if (actions.indexOf(terminateAction) === -1) {
                    console.log(util.format('Not terminating server "%s": "%s" action is unavailable. Available actions are: %j', serverName, terminateAction, actions))

                    return
                  }

                  console.log(util.format('Terminating server "%s"', serverName))

                  return client
                    .post('/servers/' + serverId + '/action', { action: terminateAction })
                    .then(() => {
                      console.log(util.format('Done terminating server "%s"', serverName))
                    })
                })
            )
          }
        })

        if (promises.length > 0) {
          Promise.all(promises).then(() => {
            console.log('Done terminating all servers')

            resolve()
          })
        } else {
          console.log('No server to terminate')

          resolve()
        }
      })
    })
  }

  return {
    getImages,
    makeServer,
    getServersByName,
    createServersIfNotExists,
    deleteStoppedServers,
    listServers,
    startServers,
    terminateServers
  }
}