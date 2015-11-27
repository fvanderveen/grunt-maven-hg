/*
 * grunt-maven-hg
 * https://github.com/fvanderveen/grunt-maven-hg
 *
 * Copyright (c) 2015 Fabian van der Veen
 * Licensed under the MIT license.
 */

'use strict';

module.exports = function (grunt) {
	var fs = require('fs');
	var glob = require('glob');
	var ZipWriter = require('moxie-zip').ZipWriter;
	
	grunt.registerTask("mvn:prepare-release", function () {
		var releaseVersion = grunt.option('release-version');
		var developmentVersion = grunt.option('development-version');
		
		var questions = [];
		if (!releaseVersion) {
			questions.push({
				config: 'mvn.release-version',
				type: 'input',
				message: 'Release version for <%= pkg.name %>:',
				default: '<%= pkg.version %>'
			});
		}
		else {
			grunt.config.set('mvn.release-version', releaseVersion);
		}
		
		if (!developmentVersion) {
			questions.push({
				config: 'mvn.next-version',
				type: 'input',
				message: 'Next version for <%= pkg.name %>:',
				default: 'patch'
			});
		}
		else {
			grunt.config.set('mvn.next-version', developmentVersion);
		}
		
		if (questions.length) {
			grunt.config.set('prompt.prepare-release', {
				options: {
					questions: questions
				}
			});
			grunt.task.run('prompt:prepare-release');
		}
	});
	
	grunt.registerTask('mvn:preprocess', function (target) {
		var pkg = grunt.file.readJSON('package.json');
		
		grunt.config.set("mvn.artifactId", grunt.config.get("mvn.artifactId") || pkg.name);
		grunt.config.set("mvn.version", grunt.config.get("mvn.version") || pkg.version);
		
		if (target === "release") {
			grunt.config.set("mvn.repositoryUrl", grunt.config.get("mvn.release.url"));
			grunt.config.set("mvn.repositoryId", grunt.config.get("mvn.release.id"));
			var releaseVersion = grunt.config.get("mvn.release-version") || pkg.version;
			grunt.config.set("mvn.version", releaseVersion);
			
			if (releaseVersion !== pkg.version) {
				var done = this.async();
				grunt.util.spawn({ cmd: 'npm', args: ["version", grunt.config.get("mvn.version")] }, function (err, result, code) {
					grunt.verbose.write(result.stdout + "\n");
					
					if (err) {
						grunt.log.error().error("Version set failed, exit code " + code + ".");
						done(err);
					}
					else {
						grunt.util.spawn({ cmd: 'hg', args: ['ci', '-m', '[release] Prepare release of ' + pkg.name + '-' + releaseVersion] }, function (err, result, code) {
							grunt.verbose.write(result.stdout + "\n");
							
							if (err) {
								grunt.log.error().error("Version commit failed, exit code " + code + ".");
							}
							else {
								grunt.verbose.ok();
							}
							
							done(err);
						});
					}
				});
			}
		}
		else {
			grunt.config.set("mvn.repositoryUrl", grunt.config.get("mvn.snapshot.url"));
			grunt.config.set("mvn.repositoryId", grunt.config.get("mvn.snapshot.id"));
			grunt.config.set("mvn.version", grunt.config.get("mvn.version") + "-SNAPSHOT");
		}
		
		grunt.config.set("mvn.file", grunt.config.get("mvn.artifactId") + "-" + grunt.config.get("mvn.version") + ".zip");
		
		grunt.event.emit("mvn.generate-sources", grunt.config.get("mvn.version"));
	});
	
	grunt.registerTask('mvn:package', function () {
		var zip = new ZipWriter();
		
		var seenFiles = [];
		var sources = grunt.config.get("mvn.sources");
		var basePath = grunt.config.get("mvn.basePath") || "";
		
		grunt.verbose.write(sources);
		sources.forEach(function (source) {
			glob.sync(source).forEach(function (file) {
				if (seenFiles.indexOf(file) !== -1) {
					grunt.verbose.writeln("Skipping already zipped file '" + file + "'");
					return;
				}
				
				seenFiles.push(file);
				
				if (!basePath || file.indexOf(basePath) === 0) {
					if (fs.statSync(file).isFile()) {
						zip.addFile(file.substring(basePath.length), file);
					}
				}
			});
		});
		
		var archive = grunt.config.get("mvn.file");
		grunt.verbose.writeln("Creating artifact '" + archive + "'");
		
		var done = this.async();
		zip.saveAs(archive, function () {
			grunt.verbose.writeln("Created artifact " + archive);
			done(true);
		});
	});
	
	grunt.registerTask('mvn:upload', function () {
		var args = ["deploy:deploy-file", "-Dpackaging=zip"];
		if (grunt.config.get("mvn.debug")) {
			args.push("--debug");
		}
		var repositoryId = grunt.config.get("mvn.repositoryId");
		if (repositoryId) {
			args.push("-DrepositoryId=" + repositoryId);
		}
		args.push("-Durl=" + grunt.config.get("mvn.repositoryUrl"));
		args.push("-Dfile=" + grunt.config.get("mvn.file"));
		args.push("-DgroupId=" + grunt.config.get("mvn.groupId"));
		args.push("-DartifactId=" + grunt.config.get("mvn.artifactId"));
		args.push("-Dversion=" + grunt.config.get("mvn.version"));
		
		grunt.verbose.writeln("Running: mvn " + args.join(" "));
		
		var done = this.async();
		grunt.util.spawn({ cmd: 'mvn', args: args }, function (err, result, code) {
			if (err) {
				grunt.log.error().error("Deployment failed, exit code " + code + ".");
			}
			else {
				grunt.verbose.ok();
			}
			
			grunt.verbose.write(result.stdout + "\n");
			done(err);
		});
	});
	
	grunt.registerTask('mvn:tag-release', function () {
		var done = this.async();
		var pkg = grunt.file.readJSON('package.json');
		
		var releaseName = grunt.option('tag') || (pkg.name + "-" + pkg.version);
		grunt.util.spawn({ cmd: 'hg', args: ["tag", releaseName, "-m", "[release] Release of " + releaseName] }, function (err, result, code) {
			grunt.verbose.write(result.stdout + "\n");
			
			if (!err) {
				grunt.verbose.ok();
				grunt.task.run('mvn:bump-version');
			} else {
				grunt.log.error().error("Release tagging failed, exit code " + code + ".");
			}
			
			done(err);
		});
	});
	
	grunt.registerTask('mvn:bump-version', function () {
		var nextVersion = grunt.config.get("mvn.next-version") || "patch";
		var done = this.async();
		
		grunt.util.spawn({ cmd: 'npm', args: ["version", nextVersion] }, function (err, result, code) {
			if (err) {
				grunt.log.error().error("Version bump failed, exit code " + code + ".");
			}
			else {
				grunt.verbose.ok();
				grunt.task.run('mvn:commit-bump');
			}
			
			grunt.verbose.write(result.stdout + "\n");
			done(err);
		});
	});
	
	grunt.registerTask('mvn:commit-bump', function () {
		var done = this.async();
		
		grunt.util.spawn({ cmd: 'hg', args: ["commit", "-m", "[release] prepare for next development iteration", "package.json"] }, function (err, result, code) {
			grunt.verbose.write(result.stdout + "\n");
			
			if (!err) {
				grunt.verbose.ok();
			} else {
				grunt.log.error().error("Version bump commit failed, exit code " + code + ".");
			}
			
			done(err);
		});
	});
	
	grunt.loadNpmTasks("grunt-prompt");
	
	grunt.registerTask('mvn:deploy', ["mvn:preprocess:snapshot", "mvn:package", "mvn:upload"]);
	grunt.registerTask('mvn:release', ["mvn:prepare-release", "mvn:preprocess:release", "mvn:package", "mvn:upload", "mvn:tag-release"]);
};
