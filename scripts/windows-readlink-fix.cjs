// Some Windows filesystems return EISDIR instead of EINVAL for readlink on
// ordinary files. Next's file tracer expects EINVAL for non-symlinks.
const fs = require('node:fs')
if (process.platform === 'win32') {
  const readlink = fs.readlink
  fs.readlink = function (path, ...args) {
    const callback = args.pop()
    return readlink.call(fs, path, ...args, (error, result) => {
      if (error?.code !== 'EISDIR') return callback(error, result)
      fs.lstat(path, (statError, stat) => {
        if (!statError && !stat.isSymbolicLink()) error.code = 'EINVAL'
        callback(error, result)
      })
    })
  }
  const promiseReadlink = fs.promises.readlink
  fs.promises.readlink = async function (path, ...args) {
    try { return await promiseReadlink.call(this, path, ...args) }
    catch (error) {
      if (error?.code === 'EISDIR') {
        try { if (!(await fs.promises.lstat(path)).isSymbolicLink()) error.code = 'EINVAL' } catch { /* preserve the original error */ }
      }
      throw error
    }
  }
  const readlinkSync = fs.readlinkSync
  fs.readlinkSync = function (path, ...args) {
    try { return readlinkSync.call(fs, path, ...args) }
    catch (error) {
      if (error?.code === 'EISDIR') {
        try { if (!fs.lstatSync(path).isSymbolicLink()) error.code = 'EINVAL' } catch { /* preserve the original error */ }
      }
      throw error
    }
  }
}
