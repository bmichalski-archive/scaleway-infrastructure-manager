'use strict'

process.on('unhandledRejection', (reason) => {
  throw reason
})

const Promise = require('bluebird')
const superagentRequest = require('superagent')
const util = require('util')
const _ = require('lodash')

module.exports = (conf) => {
  const request = (opts) => {
    const rq = superagentRequest(opts.method, 'https://api.scaleway.com' + opts.uri)
      .set('Content-Type', 'application/json')
      .set('X-Auth-Token', conf.apiToken)

    if (undefined !== opts.body) {
      rq.send(opts.body)
    }

    return rq
  }

  const getImages = () => {
    console.log('Getting images.')

    return new Promise((resolve) => {
      request({
        method: 'GET',
        uri: '/images'
      }).then((res) => {
        resolve(res.body.images)
      })
    })
  }

  const makeServer = (name, serverType, imageId, tags) => {
    const body = {
      name: name,
      organization: conf.organization,
      commercial_type: serverType,
      image: imageId,
      tags: tags
    }

    console.log(util.format('Making server "%s" of type "%s"', name, serverType))

    return request({
      method: 'POST',
      uri: '/servers',
      body
    })
      .then(() => {
        console.log(util.format('Successfully made server "%s"', name))
      })
  }

  const getServersByName = () => {
    return new Promise((resolve) => {
      request({
        method: 'GET',
        uri: '/servers'
      }).then((res) => {
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
            request({
              method: 'DELETE',
              uri: '/servers/' + serverId
            })
              .then(() => {
                console.log(util.format('Done deleting server "%s"', serverName))

                return new Promise((resolve) => {
                  const promises = []

                  console.log(util.format('Deleting volumes for server "%s"', serverName))

                  serverVolumeIds.forEach((serverVolumeId) => {
                    console.log(util.format('Deleting volume "%s" for server "%s"', serverVolumeId, serverName))

                    promises.push(
                      request({
                        method: 'DELETE',
                        uri: '/volumes/' + serverVolumeId
                      })
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

  const listServers = (expectedServers) => {
    return getServersByName().then((actualServersByName) => {
      const expectedServersInfo = []

      expectedServers.forEach((expectedServer) => {
        const serverName = expectedServer.name
        const actualServer = actualServersByName[serverName]

        if (undefined === actualServer) {
          expectedServersInfo.push({
            name: serverName,
            present: false
          })
        } else {
          expectedServersInfo.push({
            name: serverName,
            present: true,
            info: actualServer
          })
        }
      })

      return new Promise((resolve) => {
        resolve(expectedServersInfo)
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
              request({
                method: 'GET',
                uri: '/servers/' + serverId + '/action'
              })
                .then((res) => {
                  const actions = res.body.actions

                  if (actions.indexOf(powerOnAction) === -1) {
                    console.log(util.format('Not starting server "%s": "%s" action is unavailable. Available actions are: %j', serverName, powerOnAction, actions))

                    return
                  }

                  console.log(util.format('Starting server "%s"', serverName))

                  return request({
                    method: 'POST',
                    uri: '/servers/' + serverId + '/action',
                    body: {
                      action: powerOnAction
                    }
                  })
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
              request({
                method: 'GET',
                uri: '/servers/' + serverId + '/action'
              })
                .then((res) => {
                  const actions = res.body.actions

                  if (actions.indexOf(terminateAction) === -1) {
                    console.log(util.format('Not terminating server "%s": "%s" action is unavailable. Available actions are: %j', serverName, terminateAction, actions))

                    return
                  }

                  console.log(util.format('Terminating server "%s"', serverName))

                  return request({
                    method: 'POST',
                    uri: '/servers/' + serverId + '/action',
                    body: {
                      action: terminateAction
                    }
                  })
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

  const waitUntil = (checkWaitUntil, serversToWaitFor, withServers) => {
    let startedAt = Date.now()

    const checkServerStatuses = () => {
      return getServersByName().then((actualServersByName) => {
        const countExpectedServers = serversToWaitFor.length
        let noLongerWaitAfterServersCount = 0
        const serversData = []
        const waitingFor = (Date.now() - startedAt) / 1000

        serversToWaitFor.forEach((serverToWaitFor) => {
          const serverName = serverToWaitFor.name
          const actualServer = actualServersByName[serverName]
          const present = undefined !== actualServer
          const data = {
            name: serverName,
            present,
            waitingFor
          }

          if (present) {
            data.info = actualServer
          }

          serversData.push(data)

          if (checkWaitUntil(actualServer)) {
            noLongerWaitAfterServersCount += 1
          }
        })

        const done = countExpectedServers === noLongerWaitAfterServersCount

        withServers(serversData)

        if (!done) {
          return Promise.delay(1000).then(checkServerStatuses)
        }
      })
    }

    return checkServerStatuses()
  }

  const doLocal = (serversToActOn, doLocal) => {
    return getServersByName().then((actualServersByName) => {
      const promises = []

      serversToActOn.forEach((serverToActOn) => {
        const serverName = serverToActOn.name
        const actualServer = actualServersByName[serverName]

        if (undefined === actualServer) {
          console.log(util.format('Doing nothing with server "%s": server is not available', serverName))

          return
        }

        promises.push(doLocal(actualServer))
      })

      if (promises.length > 0) {
        return Promise.all(promises).then(() => {
          console.log('Done acting on servers')
        })
      }

      console.log('Nothing has been done with any server')
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
    terminateServers,
    waitUntil,
    doLocal
  }
}